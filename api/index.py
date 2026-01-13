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
            
            # 鍵権限者（店長・リーダー・社員）
            key_holders = [] 

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
                    key_holders.append(doc.id) # 鍵を持てる人

            # 設定値取得
            doc_id = f"{TARGET_YEAR}-{TARGET_MONTH}"
            config_doc = db.collection("monthlyConfig").document(doc_id).get()
            daily_sales = {}
            config_caps = {"salesLow":100, "hoursLow":70, "salesHigh":500, "hoursHigh":100}
            min_skills = {}
            meetings = {}

            if config_doc.exists:
                conf = config_doc.to_dict()
                daily_sales = conf.get("dailySales", {})
                config_caps = conf.get("caps", config_caps)
                min_skills = conf.get("minSkills", {})
                meetings = conf.get("meetings", {})

            # シフト希望取得
            request_map = {str(d): {} for d in range(1, DAYS_IN_MONTH + 1)}
            shifts = db.collection("shifts").where(filter=FieldFilter("year", "==", TARGET_YEAR)).where(filter=FieldFilter("month", "==", TARGET_MONTH)).stream()
            for s in shifts:
                d = s.to_dict()
                sid = d["staffId"]
                # 会議シフトを強制適用
                # (request_mapより優先されるように、後で判定)
                for day, req in d.get("requests", {}).items():
                    if day in request_map:
                        request_map[day][sid] = req

            # --- 2. 数理モデル ---
            problem = pulp.LpProblem("Shift_Scheduling", pulp.LpMaximize)
            shift_types = ["A", "B", "C", "M"] # A:早, B:中, C:遅, M:会議
            staff_ids = list(staffs.keys())
            days = [str(d) for d in range(1, DAYS_IN_MONTH + 1)]

            x = {}
            for d in days:
                for s in staff_ids:
                    for st in shift_types:
                        x[d, s, st] = pulp.LpVariable(f"x_{d}_{s}_{st}", 0, 1, pulp.LpBinary)

            # --- 3. 制約条件 ---
            for d in days:
                # 1. 会議シフトの強制
                # 管理者が登録した会議リストにあれば、強制的に "M" にする
                meeting_members = meetings.get(d, [])
                for s in meeting_members:
                    if s in staff_ids:
                        problem += x[d, s, "M"] == 1
                        # 他のシフトは0
                        problem += x[d, s, "A"] + x[d, s, "B"] + x[d, s, "C"] == 0

                # 2. 1人1日1シフト (会議含む)
                for s in staff_ids:
                    problem += pulp.lpSum([x[d, s, st] for st in shift_types]) <= 1

                # 3. 売上連動の労働時間キャップ
                # ※会議(M)は労働時間には含めないが、人数には含まない
                sales = int(daily_sales.get(d, 0))
                
                # キャップ計算
                if sales <= config_caps["salesLow"]:
                    limit_hours = config_caps["hoursLow"]
                elif sales <= config_caps["salesHigh"]:
                    limit_hours = config_caps["hoursHigh"]
                else:
                    limit_hours = 9999 # 無制限

                # 労働時間の合計 (A/B/C のみ。仮に全員8時間とする)
                # 正確には時間指定シフトがあるが、ここでは簡易的に枠数×8hで計算
                total_work_slots = pulp.lpSum([x[d, s, st] for s in staff_ids for st in ["A","B","C"]])
                problem += total_work_slots * 8 <= limit_hours

                # 4. 部門最低人数 (会議Mは店にいないのでカウントしない)
                for dept_name, members in dept_groups.items():
                    if len(members) > 0:
                        problem += pulp.lpSum([x[d, s, st] for s in members for st in ["A","B","C"]]) >= 1

                # 5. スキル要件 (会議Mはカウントしない)
                for skill_name, min_val in min_skills.items():
                    if min_val > 0:
                        # その日の合計スキル値 >= 必要値
                        current_skill_sum = pulp.lpSum([
                            x[d, s, st] * (staffs[s].get("skills", {}).get(skill_name, 0))
                            for s in staff_ids for st in ["A","B","C"]
                        ])
                        problem += current_skill_sum >= min_val

                # 6. 鍵の確保
                # Open(A)には「鍵開け(canOpen)」ができる人が最低1人必要
                openers = [s for s in staff_ids if staffs[s].get("canOpen") == True]
                if openers:
                    problem += pulp.lpSum([x[d, s, "A"] for s in openers]) >= 1
                
                # Last(C)には「鍵締め(canClose)」ができる人が最低1人必要
                closers = [s for s in staff_ids if staffs[s].get("canClose") == True]
                if closers:
                    problem += pulp.lpSum([x[d, s, "C"] for s in closers]) >= 1
                
                # ※3本あるのでリレー制約（前日Last→翌日Open）は厳密には必須ではないが、
                # 運用上「鍵所有者が必ずいる」ことは上記で担保される。

            # --- 個人制約 ---
            for s in staff_ids:
                # 希望休・有給 (会議とバッティングした場合は会議優先だが、ここでは希望を優先度低として扱う)
                # ただし「有給」は絶対確保したい
                req = None
                requests = request_map.get(d, {}) # バグ修正: ループ外でreq_mapを参照すべき
                
            # 再ループ
            for s in staff_ids:
                # 月間勤務日数上限
                max_days = staffs[s].get("maxDays", 22)
                # 会議(M)も勤務日数には含む
                problem += pulp.lpSum([x[d, s, st] for d in days for st in shift_types]) <= max_days

                # 日別希望処理
                for d in days:
                    # 会議メンバーなら既に固定済みなのでスキップ
                    if s in meetings.get(d, []):
                        continue

                    req = request_map[d].get(s, {})
                    r_type = req.get("type")

                    if r_type == "有給":
                        problem += pulp.lpSum([x[d, s, st] for st in shift_types]) == 0
                    elif r_type == "希望休":
                         # 優先度低めだが、基本は叶える（目的関数で調整も可能だが、一旦ハード制約）
                        problem += pulp.lpSum([x[d, s, st] for st in shift_types]) == 0
                    elif r_type in ["早番", "中番", "遅番"]:
                        target = "A" if r_type=="早番" else "B" if r_type=="中番" else "C"
                        # 指定以外は0
                        for st in ["A","B","C"]:
                            if st != target:
                                problem += x[d, s, st] == 0
                        # 会議でなければ、希望シフトには入る（休みにはしない）
                        problem += x[d, s, target] == 1
                    elif r_type == "時間指定":
                        # 時間指定があれば、何かしらのシフト(A,B,C)には入る
                        problem += pulp.lpSum([x[d, s, st] for st in ["A","B","C"]]) == 1

            # --- 4. 目的関数 ---
            # シフト枠を埋めることを最大化
            problem += pulp.lpSum([x[d, s, st] for d in days for s in staff_ids for st in ["A","B","C"]])

            # --- 5. 実行 ---
            status = problem.solve(pulp.PULP_CBC_CMD(msg=0))

            if status == pulp.LpStatusOptimal:
                final_schedule = {}
                for d in days:
                    day_assignments = []
                    for s in staff_ids:
                        for st in shift_types:
                            if x[d, s, st].value() == 1:
                                # 時間指定の場合は元の時間を復元する
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
                                    label = st # A, B, C

                                day_assignments.append({
                                    "staffId": s,
                                    "name": staffs[s]["name"],
                                    "shift": label,
                                    "start": start_time,
                                    "end": end_time
                                })
                    final_schedule[d] = day_assignments

                # 保存
                db.collection("determined_shifts").document(doc_id).set({
                    "year": TARGET_YEAR,
                    "month": TARGET_MONTH,
                    "schedule": final_schedule,
                    "createdAt": firestore.SERVER_TIMESTAMP
                })
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"message": "シフト作成成功！(会議・スキル・キャップ適用済)"}).encode('utf-8'))
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