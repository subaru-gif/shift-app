import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter
import pulp
import warnings

warnings.filterwarnings("ignore")

# --- 1. 設定 ---
TARGET_YEAR = 2026
TARGET_MONTH = 2
DAYS_IN_MONTH = 28 

if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
db = firestore.client()

print(f"🤖 シフト自動作成を開始します: {TARGET_YEAR}年{TARGET_MONTH}月")

# --- 2. データ取得 ---
staffs = {}
docs = db.collection("staffs").stream()
for doc in docs:
    staffs[doc.id] = doc.to_dict()

# 部門ごとにスタッフIDを分けておく
dept_groups = {"家電": [], "季節": [], "情報": [], "通信": []}
for s_id, s_data in staffs.items():
    dept = s_data.get("department")
    if dept in dept_groups:
        dept_groups[dept].append(s_id)

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

# --- 3. モデル作成 ---
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
    
    # 予算制約
    problem += pulp.lpSum([x[d, s, st] for s in staff_ids for st in shift_types]) <= max_staff

    # 遅番の締め作業者確保
    closer_vars = [x[d, s, "C"] for s in staff_ids if staffs[s].get("canClose") == True]
    if closer_vars:
        problem += pulp.lpSum(closer_vars) >= 1

    # 【追加ルール】各部門、最低1人は出勤する
    # ※ただし、その部門に誰も登録されていない場合はスキップ
    for dept_name, members in dept_groups.items():
        if len(members) > 0:
            # その部門のメンバーの出勤フラグ合計 >= 1
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

# --- 6. 計算 ---
print("🧮 計算中...")
status = problem.solve(pulp.PULP_CBC_CMD(msg=0))

# --- 7. 結果 ---
print("-" * 30)
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
        names = [f"{a['name']}" for a in day_assignments]
        print(f"📅 {d}日 -> {len(names)}人出勤")

    doc_id = f"{TARGET_YEAR}-{TARGET_MONTH}"
    db.collection("determined_shifts").document(doc_id).set({
        "year": TARGET_YEAR,
        "month": TARGET_MONTH,
        "schedule": final_schedule,
        "createdAt": firestore.SERVER_TIMESTAMP
    })
    print(f"✨ 保存完了！Firebaseに書き込みました。")
else:
    print("❌ 作成失敗。条件が厳しすぎます（予算不足で部門人数が確保できない等）。")