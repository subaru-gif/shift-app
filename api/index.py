from http.server import BaseHTTPRequestHandler
import json
import os
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter
import pulp
import warnings

warnings.filterwarnings("ignore")

def initialize_firebase():
    if not firebase_admin._apps:
        env_key = os.environ.get('FIREBASE_KEY')
        if env_key:
            cred_dict = json.loads(env_key)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred)
        else:
            local_key_path = os.path.join(os.path.dirname(__file__), '../serviceAccountKey.json')
            if os.path.exists(local_key_path):
                cred = credentials.Certificate(local_key_path)
                firebase_admin.initialize_app(cred)
            else:
                print("⚠️ 鍵が見つかりません")

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            initialize_firebase()
            db = firestore.client()

            TARGET_YEAR = 2026
            TARGET_MONTH = 2
            DAYS_IN_MONTH = 28

            # --- 1. データ取得 ---
            staffs = {}
            docs = db.collection("staffs").stream()
            
            dept_groups = {"家電": [], "季節": [], "情報": [], "通信": []}
            newcomers = [] 
            mentors = []
            
            for doc in docs:
                data = doc.to_dict()
                staffs[doc.id] = data
                dept = data.get("department")
                if dept in dept_groups:
                    dept_groups[dept].append(doc.id)
                
                rank_id = data.get("rankId", 99)
                if rank_id == 5: 
                    newcomers.append(doc.id)
                elif rank_id <= 3:
                    mentors.append(doc.id)

            # 設定値
            doc_id = f"{TARGET_YEAR}-{TARGET_MONTH}"
            config_doc = db.collection("monthlyConfig").document(doc_id).get()
            daily_sales = {}
            config_caps = {"salesLow":100, "hoursLow":70, "salesHigh":500, "hoursHigh":100}
            min_skills = {}
            min_staff_counts = {"open": 3, "close": 3}
            meetings = {}

            if config_doc.exists:
                conf = config_doc.to_dict()
                daily_sales = conf.get("dailySales", {})
                config_caps = conf.get("caps", config_caps)
                min_skills = conf.get("minSkills", {})
                min_staff_counts = conf.get("minStaffCounts", min_staff_counts)
                meetings = conf.get("meetings", {})

            # シフト希望
            request_map = {str(d): {} for d in range(1, DAYS_IN_MONTH + 1)}
            shifts = db.collection("shifts").where(filter=FieldFilter("year", "==", TARGET_YEAR)).where(filter=FieldFilter("month", "==", TARGET_MONTH)).stream()
            for s in shifts:
                d = s.to_dict()
                sid = d["staffId"]
                for day, req in d.get("requests", {}).items():
                    if day in request_map:
                        request_map[day][sid] = req

            # --- 2. 数理モデル ---
            problem = pulp.LpProblem("Shift_Scheduling", pulp.LpMaximize)
            shift_types = ["A", "B", "C", "M"] 
            staff_ids = list(staffs.keys())
            days = [str(d) for d in range(1, DAYS_IN_MONTH + 1)]

            x = {}
            for d in days:
                for s in staff_ids:
                    for st in shift_types:
                        x[d, s, st] = pulp.LpVariable(f"x_{d}_{s}_{st}", 0, 1, pulp.LpBinary)

            # --- 3. 制約条件 ---
            for d in days:
                # 1. 会議シフト
                meeting_members = meetings.get(d, [])
                for s in meeting_members:
                    if s in staff_ids:
                        problem += x[d, s, "M"] == 1
                        problem += x[d, s, "A"] + x[d, s, "B"] + x[d, s, "C"] == 0

                # 2. 1人1日1シフト
                for s in staff_ids:
                    problem += pulp.lpSum([x[d, s, st] for st in shift_types]) <= 1

                # 3. 労働時間キャップ
                sales = int(daily_sales.get(d, 0))
                if sales <= config_caps["salesLow"]:
                    limit_hours = config_caps["hoursLow"]
                elif sales <= config_caps["salesHigh"]:
                    limit_hours = config_caps["hoursHigh"]
                else:
                    limit_hours = 9999 

                total_work_slots = pulp.lpSum([x[d, s, st] for s in staff_ids for st in ["A","B","C"]])
                problem += total_work_slots * 8 <= limit_hours

                # 4. 部門最低人数 -> 緩和

                # 5. スキル要件
                for skill_name, min_val in min_skills.items():
                    if min_val > 0:
                        current_skill_sum = pulp.lpSum([
                            x[d, s, st] * (staffs[s].get("skills", {}).get(skill_name, 0))
                            for s in staff_ids for st in ["A","B","C"]
                        ])
                        problem += current_skill_sum >= min_val

                # 6. 鍵
                openers = [s for s in staff_ids if staffs[s].get("canOpen") == True]
                if openers:
                    problem += pulp.lpSum([x[d, s, "A"] for s in openers]) >= 1
                
                closers = [s for s in staff_ids if staffs[s].get("canClose") == True]
                if closers:
                    problem += pulp.lpSum([x[d, s, "C"] for s in closers]) >= 1

                # 7. 開け・締め人数 (時間指定含む)
                
                # Open人数 (9:30-10:00にいる人)
                count_open_vars = []
                count_close_vars = []
                
                for s in staff_ids:
                    req = request_map[d].get(s, {})
                    
                    if req.get("type") == "時間指定":
                        # 時間指定の人: 開始時間が10:00以下ならOpen要員
                        sh = int(req.get("start", "00:00").split(":")[0])
                        if sh <= 10:
                            count_open_vars.append(pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]))
                        
                        # 終了時間が21:30以上ならClose要員
                        eh_str = req.get("end", "00:00")
                        eh = int(eh_str.split(":")[0])
                        em = int(eh_str.split(":")[1])
                        if eh > 21 or (eh == 21 and em >= 30):
                             count_close_vars.append(pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]))
                    
                    else:
                        # 通常の人
                        count_open_vars.append(x[d, s, "A"]) 
                        count_close_vars.append(x[d, s, "C"]) 
                
                problem += pulp.lpSum(count_open_vars) >= min_staff_counts.get("open", 3)
                problem += pulp.lpSum(count_close_vars) >= min_staff_counts.get("close", 3)

                # 8. 新人サポート
                if len(newcomers) > 0 and len(mentors) > 0:
                    for nc in newcomers:
                        nc_working = pulp.lpSum([x[d, nc, st] for st in ["A","B","C"]])
                        mentors_working = pulp.lpSum([x[d, m, st] for m in mentors for st in ["A","B","C"]])
                        problem += nc_working <= mentors_working

            # --- 個人制約 ---
            for s in staff_ids:
                max_days = staffs[s].get("maxDays", 22)
                problem += pulp.lpSum([x[d, s, st] for d in days for st in shift_types]) <= max_days
                
                rank = staffs[s].get("rank", "")
                if rank in ["パートナー", "新規パートナー"]:
                    for d in days:
                        if s not in meetings.get(d, []):
                            if str(d) not in request_map or s not in request_map[str(d)]:
                                problem += pulp.lpSum([x[d, s, st] for st in shift_types]) == 0

                # 連勤制限
                for d_int in range(1, DAYS_IN_MONTH - 5):
                    week_vars = []
                    for offset in range(7):
                        target_day = str(d_int + offset)
                        if int(target_day) <= DAYS_IN_MONTH:
                            week_vars.extend([x[target_day, s, st] for st in shift_types])
                    if len(week_vars) == 7:
                        problem += pulp.lpSum(week_vars) <= 6
                
                # インターバル
                for d_int in range(1, DAYS_IN_MONTH):
                    d_curr = str(d_int)
                    d_next = str(d_int + 1)
                    problem += x[d_curr, s, "C"] + x[d_next, s, "A"] <= 1

                # 希望シフト
                for d in days:
                    if s in meetings.get(d, []): continue
                    req = request_map[d].get(s, {})
                    r_type = req.get("type")

                    if r_type == "有給":
                        problem += pulp.lpSum([x[d, s, st] for st in shift_types]) == 0
                    elif r_type == "希望休":
                        problem += pulp.lpSum([x[d, s, st] for st in shift_types]) == 0
                    elif r_type in ["早番", "中番", "遅番"]:
                        target = "A" if r_type=="早番" else "B" if r_type=="中番" else "C"
                        problem += x[d, s, target] == 1
                    elif r_type == "時間指定":
                        problem += pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]) == 1

            # --- 4. 目的関数 ---
            obj_vars = []
            for d in days:
                for s in staff_ids:
                    rank_id = staffs[s].get("rankId", 99)
                    
                    # 基本重み
                    if rank_id <= 3:
                        # 社員は最優先 (P1相当)
                        weight = 100.0
                    else:
                        # パートナーは設定値に従う
                        p = str(staffs[s].get("priority", "2"))
                        if p == "1": weight = 100.0
                        elif p == "3": weight = 10.0
                        else: weight = 50.0 # P2 (Default)

                    for st in ["A","B","C"]:
                        obj_vars.append(x[d, s, st] * weight)
            
            problem += pulp.lpSum(obj_vars)

            # --- 5. 実行 ---
            status = problem.solve(pulp.PULP_CBC_CMD(msg=0))

            if status == pulp.LpStatusOptimal:
                final_schedule = {}
                for d in days:
                    day_assignments = []
                    for s in staff_ids:
                        for st in shift_types:
                            if x[d, s, st].value() == 1:
                                req = request_map[d].get(s, {})
                                start_time = ""
                                end_time = ""
                                
                                if st == "M":
                                    label = "会議"
                                elif req.get("type") == "時間指定":
                                    label = "時間指定"
                                    start_time = req.get("start")
                                    end_time = req.get("end")
                                else:
                                    label = st 

                                day_assignments.append({
                                    "staffId": s,
                                    "name": staffs[s]["name"],
                                    "shift": label,
                                    "start": start_time,
                                    "end": end_time
                                })
                    final_schedule[d] = day_assignments

                db.collection("determined_shifts").document(doc_id).set({
                    "year": TARGET_YEAR,
                    "month": TARGET_MONTH,
                    "schedule": final_schedule,
                    "createdAt": firestore.SERVER_TIMESTAMP
                })
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"message": "シフト作成成功！"}).encode('utf-8'))
            else:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "条件不成立: 設定を見直してください"}).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))