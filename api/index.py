from http.server import BaseHTTPRequestHandler
import json
import os
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter
import pulp
import warnings

# 警告を無視
warnings.filterwarnings("ignore")

# --- Firebase初期化（ここが最重要！） ---
# クラウド上ではファイルではなく「環境変数」から鍵を読み込みます
def initialize_firebase():
    if not firebase_admin._apps:
        # 環境変数 'FIREBASE_KEY' があればそれを使う（本番用）
        env_key = os.environ.get('FIREBASE_KEY')
        
        if env_key:
            # 改行コードなどが崩れている場合があるので修正して読み込む
            cred_dict = json.loads(env_key)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred)
        else:
            # なければローカルのファイルを探す（開発用）
            # ※ apiフォルダの一つ上にある想定
            local_key_path = os.path.join(os.path.dirname(__file__), '../serviceAccountKey.json')
            if os.path.exists(local_key_path):
                cred = credentials.Certificate(local_key_path)
                firebase_admin.initialize_app(cred)
            else:
                print("⚠️ 鍵が見つかりません")

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # ブラウザでアクセスされた時の応答（動作確認用）
        self.send_response(200)
        self.send_header('Content-type', 'text/plain; charset=utf-8')
        self.end_headers()
        self.wfile.write("Shift AI API is Running!".encode('utf-8'))

    def do_POST(self):
        # シフト作成ボタンが押された時の処理
        try:
            initialize_firebase()
            db = firestore.client()

            # --- 1. 設定（リクエストから受け取ることも可能だが一旦固定） ---
            TARGET_YEAR = 2026
            TARGET_MONTH = 2
            DAYS_IN_MONTH = 28 # 本来はカレンダー計算すべき

            # --- 2. データ取得 ---
            staffs = {}
            docs = db.collection("staffs").stream()
            dept_groups = {"家電": [], "季節": [], "情報": [], "通信": []}

            for doc in docs:
                data = doc.to_dict()
                staffs[doc.id] = data
                dept = data.get("department")
                if dept in dept_groups:
                    dept_groups[dept].append(doc.id)

            daily_sales = {}
            config = db.collection("monthlyConfig").document(f"{TARGET_YEAR}-{TARGET_MONTH}").get()
            if config.exists:
                daily_sales = config.to_dict().get("dailySales", {})

            request_map = {str(d): {} for d in range(1, DAYS_IN_MONTH + 1)}
            shifts = db.collection("shifts").where(filter=FieldFilter("year", "==", TARGET_YEAR)).where(filter=FieldFilter("month", "==", TARGET_MONTH)).stream()
            for s in shifts:
                d = s.to_dict()
                for day, req in d.get("requests", {}).items():
                    if day in request_map:
                        request_map[day][d["staffId"]] = req.get("type")

            # --- 3. 計算モデル ---
            problem = pulp.LpProblem("Shift_Scheduling", pulp.LpMaximize)
            shift_types = ["A", "B", "C"]
            staff_ids = list(staffs.keys())
            days = [str(d) for d in range(1, DAYS_IN_MONTH + 1)]

            x = {}
            for d in days:
                for s_id in staff_ids:
                    for st in shift_types:
                        x[d, s_id, st] = pulp.LpVariable(f"x_{d}_{s_id}_{st}", 0, 1, pulp.LpBinary)

            # --- 4. 制約 ---
            for d in days:
                sales_val = int(daily_sales.get(d, 0))
                max_staff = max(1, int(sales_val / 10))
                
                problem += pulp.lpSum([x[d, s, st] for s in staff_ids for st in shift_types]) <= max_staff

                closer_vars = [x[d, s, "C"] for s in staff_ids if staffs[s].get("canClose") == True]
                if closer_vars:
                    problem += pulp.lpSum(closer_vars) >= 1

                for dept_name, members in dept_groups.items():
                    if len(members) > 0:
                        problem += pulp.lpSum([x[d, s, st] for s in members for st in shift_types]) >= 1

                for s_id in staff_ids:
                    req_type = request_map[d].get(s_id)
                    problem += pulp.lpSum([x[d, s_id, st] for st in shift_types]) <= 1

                    if req_type == "希望休" or req_type == "有給":
                        problem += pulp.lpSum([x[d, s_id, st] for st in shift_types]) == 0
                    elif req_type in ["早番", "中番", "遅番"]:
                        target = "A" if req_type == "早番" else "B" if req_type == "中番" else "C"
                        for st in shift_types:
                            if st != target:
                                problem += x[d, s_id, st] == 0
                    elif req_type == "時間指定":
                        problem += pulp.lpSum([x[d, s_id, st] for st in shift_types]) == 1

            # --- 5. 目的 ---
            problem += pulp.lpSum([x[d, s, st] for d in days for s in staff_ids for st in shift_types])

            # --- 6. 実行 ---
            status = problem.solve(pulp.PULP_CBC_CMD(msg=0))

            if status == pulp.LpStatusOptimal:
                final_schedule = {}
                for d in range(1, DAYS_IN_MONTH + 1):
                    d_str = str(d)
                    day_assignments = []
                    for s_id in staff_ids:
                        for st in shift_types:
                            if x[d_str, s_id, st].value() == 1:
                                assign_data = {
                                    "staffId": s_id,
                                    "name": staffs[s_id]["name"],
                                    "shift": st
                                }
                                day_assignments.append(assign_data)
                    final_schedule[d_str] = day_assignments

                # 保存
                doc_id = f"{TARGET_YEAR}-{TARGET_MONTH}"
                db.collection("determined_shifts").document(doc_id).set({
                    "year": TARGET_YEAR,
                    "month": TARGET_MONTH,
                    "schedule": final_schedule,
                    "createdAt": firestore.SERVER_TIMESTAMP
                })
                
                # 成功レスポンス
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"message": "Shift created successfully!"}).encode('utf-8'))
            else:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Infeasible"}).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))