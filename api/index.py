from http.server import BaseHTTPRequestHandler
import json
import os
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter
import pulp
import warnings
import datetime 

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

            # ==========================================
            # 1. データ取得 & 整理
            # ==========================================
            staffs = {}
            docs = db.collection("staffs").stream()
            
            dept_groups = {"家電": [], "季節": [], "情報": [], "通信": []}
            
            store_managers = [] 
            leaders_and_managers = [] 
            employees = [] 
            partners = [] 
            newcomers = [] 
            
            for doc in docs:
                data = doc.to_dict()
                staffs[doc.id] = data
                
                # 役職名からRankIDを強制補正
                rank_str = data.get("rank", "")
                if rank_str == "店長": rank_id = 1
                elif rank_str == "リーダー": rank_id = 2
                elif rank_str == "社員": rank_id = 3
                elif rank_str == "パートナー": rank_id = 4
                elif rank_str == "新規パートナー": rank_id = 5
                else: rank_id = data.get("rankId", 99)
                
                staffs[doc.id]["rankId"] = rank_id 

                # 部門分け
                dept = data.get("department")
                if dept in dept_groups:
                    dept_groups[dept].append(doc.id)

                if rank_id == 1: store_managers.append(doc.id)
                if rank_id <= 2: leaders_and_managers.append(doc.id)
                if rank_id <= 3: employees.append(doc.id)
                if rank_id == 4: partners.append(doc.id)
                if rank_id == 5: newcomers.append(doc.id)

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

            # ==========================================
            # 2. 数理モデル作成
            # ==========================================
            problem = pulp.LpProblem("Shift_Scheduling", pulp.LpMaximize)
            shift_types = ["A", "B", "C", "M"] 
            staff_ids = list(staffs.keys())
            days = [str(d) for d in range(1, DAYS_IN_MONTH + 1)]

            x = {}
            for d in days:
                for s in staff_ids:
                    for st in shift_types:
                        x[d, s, st] = pulp.LpVariable(f"x_{d}_{s}_{st}", 0, 1, pulp.LpBinary)

            obj_vars = []

            # ==========================================
            # 3. 日別ループで制約を一括適用
            # ==========================================
            for d in days:
                current_date = datetime.date(TARGET_YEAR, TARGET_MONTH, int(d))
                is_weekend = current_date.weekday() >= 5

                # --- 3-1. 基本制約 ---
                for s in staff_ids:
                    problem += pulp.lpSum([x[d, s, st] for st in shift_types]) <= 1

                # 会議
                meeting_members = meetings.get(d, [])
                for s in staff_ids:
                    if s in meeting_members:
                        problem += x[d, s, "M"] == 1 
                        problem += x[d, s, "A"] + x[d, s, "B"] + x[d, s, "C"] == 0
                    else:
                        problem += x[d, s, "M"] == 0

                # --- 3-2. 人数・鍵カウント ---
                count_open_staff = [] 
                count_close_staff = [] 
                count_open_key = [] 
                count_close_key = [] 
                total_partner_hours = [] 

                for s in staff_ids:
                    req = request_map[d].get(s, {})
                    is_custom = (req.get("type") == "時間指定")
                    
                    start_h = 99
                    end_h = 0
                    if is_custom:
                        sh_str = req.get("start", "00:00").split(":")
                        eh_str = req.get("end", "00:00").split(":")
                        start_h = int(sh_str[0]) + int(sh_str[1])/60
                        end_h = int(eh_str[0]) + int(eh_str[1])/60

                    # 開け (10:00)
                    if is_custom:
                        if start_h <= 10.0: count_open_staff.append(pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]))
                    else:
                        count_open_staff.append(x[d, s, "A"]) 

                    # 締め (21:30)
                    if is_custom:
                        if end_h >= 21.5: count_close_staff.append(pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]))
                    else:
                        count_close_staff.append(x[d, s, "C"])

                    # 鍵開け (9:30)
                    if staffs[s].get("canOpen"):
                        if is_custom:
                            if start_h <= 9.5: count_open_key.append(pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]))
                        else:
                            count_open_key.append(x[d, s, "A"])

                    # 鍵締め (21:30)
                    if staffs[s].get("canClose"):
                        if is_custom:
                            if end_h >= 21.5: count_close_key.append(pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]))
                        else:
                            count_close_key.append(x[d, s, "C"])

                    # パートナー労働時間
                    if s in partners:
                        total_partner_hours.append(pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]) * 8)

                # --- 3-3. 制約適用 ---
                problem += pulp.lpSum(count_open_staff) >= min_staff_counts.get("open", 3)
                problem += pulp.lpSum(count_close_staff) >= min_staff_counts.get("close", 3)

                # 鍵人員確保 (絶対)
                problem += pulp.lpSum(count_open_key) >= 1
                problem += pulp.lpSum(count_close_key) >= 1

                # リーダー以上2名 (絶対)
                if leaders_and_managers:
                    problem += pulp.lpSum([
                        x[d, s, st] for s in leaders_and_managers for st in ["A","B","C"]
                    ]) >= 2

                # パートナー労働時間キャップ
                sales = int(daily_sales.get(d, 0))
                if sales <= config_caps["salesLow"]: cap = config_caps["hoursLow"]
                elif sales <= config_caps["salesHigh"]: cap = config_caps["hoursHigh"]
                else: cap = 9999
                problem += pulp.lpSum(total_partner_hours) <= cap

                # スキル (ソフト)
                for skill_name, min_val in min_skills.items():
                    if min_val > 0:
                        skill_sum = pulp.lpSum([
                            x[d, s, st] * (staffs[s].get("skills", {}).get(skill_name, 0))
                            for s in staff_ids for st in ["A","B","C"]
                        ])
                        shortage = pulp.LpVariable(f"shortage_{d}_{skill_name}", 0)
                        problem += skill_sum + shortage >= min_val
                        obj_vars.append(shortage * -100)

                # 部門の網羅性 (ソフト)
                for dept_name, members in dept_groups.items():
                    if len(members) == 0: continue
                    dept_work_sum = pulp.lpSum([x[d, s, st] for s in members for st in ["A","B","C"]])
                    dept_missing = pulp.LpVariable(f"missing_{d}_{dept_name}", 0, 1, pulp.LpBinary)
                    problem += dept_work_sum >= 1 - dept_missing
                    obj_vars.append(dept_missing * -2000)

                # 土日の社員クラス出勤ボーナス
                if is_weekend:
                    for s in employees:
                        obj_vars.append(pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]) * 1000)

            # --- 4. 個人制約 ---
            
            # ★追加: 村上 秀人 特別ルール (早番固定)
            # 名前が一致するスタッフは、中番(B)と遅番(C)を絶対禁止
            for s in staff_ids:
                if staffs[s].get("name", "") == "村上　秀人":
                    for d in days:
                        problem += x[d, s, "B"] == 0
                        problem += x[d, s, "C"] == 0

            # 全員共通: 7連勤禁止
            for s in staff_ids:
                for i in range(DAYS_IN_MONTH - 6):
                    window = days[i : i+7]
                    problem += pulp.lpSum([x[d, s, st] for d in window for st in shift_types]) <= 6

            for s in employees:
                # 店長は早番固定
                if s in store_managers:
                    for d in days:
                        problem += x[d, s, "B"] == 0
                        problem += x[d, s, "C"] == 0

                # 上限日数 (有給分を差し引く)
                max_days = staffs[s].get("maxDays", 22)
                paid_leave_count = 0
                for d in days:
                    req = request_map[d].get(s, {})
                    if req.get("type") == "有給":
                        paid_leave_count += 1
                
                workable_days = max_days - paid_leave_count
                problem += pulp.lpSum([x[d, s, st] for d in days for st in shift_types]) <= workable_days

                # 連勤ペナルティ (4連勤以上)
                for i in range(DAYS_IN_MONTH - 3):
                    d1, d2, d3, d4 = days[i], days[i+1], days[i+2], days[i+3]
                    is_4_con = pulp.LpVariable(f"c4_{s}_{d1}", 0, 1, pulp.LpBinary)
                    s_sum = pulp.lpSum([x[d, s, st] for d in [d1, d2, d3, d4] for st in shift_types])
                    problem += s_sum - 3 <= is_4_con
                    obj_vars.append(is_4_con * -500)

                # 遅番 -> 早番 回避
                for i in range(DAYS_IN_MONTH - 1):
                    d_curr, d_next = days[i], days[i+1]
                    is_interval_err = pulp.LpVariable(f"int_{s}_{d_curr}", 0, 1, pulp.LpBinary)
                    problem += x[d_curr, s, "C"] + x[d_next, s, "A"] - 1 <= is_interval_err
                    obj_vars.append(is_interval_err * -200)

                # 希望処理
                for d in days:
                    if s in meetings.get(d, []): continue
                    req = request_map[d].get(s, {})
                    r_type = req.get("type")

                    if r_type == "有給":
                        problem += pulp.lpSum([x[d, s, st] for st in shift_types]) == 0
                    elif r_type == "希望休":
                        for st in shift_types:
                            obj_vars.append(x[d, s, st] * -5000)

            for s in list(partners) + list(newcomers):
                is_new = (s in newcomers)
                for d in days:
                    if s in meetings.get(d, []): continue
                    req = request_map[d].get(s, {})
                    r_type = req.get("type")

                    if not r_type:
                        problem += pulp.lpSum([x[d, s, st] for st in shift_types]) == 0
                        continue
                    if r_type == "有給" or r_type == "希望休":
                        problem += pulp.lpSum([x[d, s, st] for st in shift_types]) == 0
                        continue

                    if is_new:
                        problem += pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]) == 1
                    else:
                        prio = str(staffs[s].get("priority", "2"))
                        weight = 100 if prio=="1" else 50 if prio=="2" else 10
                        obj_vars.append(pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]) * weight)

                    if r_type == "フリー": pass 
                    elif r_type == "早番": problem += x[d, s, "A"] == 1
                    elif r_type == "中番": problem += x[d, s, "B"] == 1
                    elif r_type == "遅番": problem += x[d, s, "C"] == 1
                    elif r_type == "時間指定": problem += pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]) == 1

            # ==========================================
            # 5. 実行
            # ==========================================
            shift_bias = {"A": 1.2, "B": 1.05, "C": 1.0}

            for d in days:
                for s in staff_ids:
                    for st in ["A","B","C"]:
                        bias = shift_bias.get(st, 1.0)
                        obj_vars.append(x[d, s, st] * bias)

            problem += pulp.lpSum(obj_vars)
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
