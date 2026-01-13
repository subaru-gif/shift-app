import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter
import pulp
import warnings

# 警告を無視
warnings.filterwarnings("ignore")

# --- 1. 設定と準備 ---
TARGET_YEAR = 2026
TARGET_MONTH = 2
DAYS_IN_MONTH = 28 

if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
db = firestore.client()

print(f"🤖 シフト自動作成を開始します: {TARGET_YEAR}年{TARGET_MONTH}月")

# --- 2. データの取得 ---
staffs = {}
docs = db.collection("staffs").stream()
for doc in docs:
    staffs[doc.id] = doc.to_dict()

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

# --- 3. 数理モデル ---
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

# --- 5. 目的関数 ---
problem += pulp.lpSum([x[d, s, st] for d in days for s in staff_ids for st in shift_types])

# --- 6. 計算 ---
print("🧮 計算中...")
status = problem.solve(pulp.PULP_CBC_CMD(msg=0))

# --- 7. 結果表示 & 保存 (ここが新機能！) ---
print("-" * 30)
if status == pulp.LpStatusOptimal:
    # 保存用のデータを作る
    final_schedule = {} # { "1": [{"name": "田中", "shift": "A"}, ...], "2": ... }

    for d in range(1, DAYS_IN_MONTH + 1):
        d_str = str(d)
        sales_val = int(daily_sales.get(d_str, 0))
        limit_num = max(1, int(sales_val / 10))

        # その日のアサインリスト
        day_assignments = []
        
        for s_id in staff_ids:
            for st in shift_types:
                if x[d_str, s_id, st].value() == 1:
                    # 採用！
                    assign_data = {
                        "staffId": s_id,
                        "name": staffs[s_id]["name"],
                        "shift": st
                    }
                    day_assignments.append(assign_data)
        
        # マップに登録
        final_schedule[d_str] = day_assignments
        
        # コンソール表示用
        names = [f"{a['name']}[{a['shift']}]" for a in day_assignments]
        print(f"📅 {d}日 (上限{limit_num}人) -> {', '.join(names) if names else '⚠️ 配置なし'}")

    # ▼▼▼ Firebaseに保存！ ▼▼▼
    doc_id = f"{TARGET_YEAR}-{TARGET_MONTH}"
    db.collection("determined_shifts").document(doc_id).set({
        "year": TARGET_YEAR,
        "month": TARGET_MONTH,
        "schedule": final_schedule,
        "createdAt": firestore.SERVER_TIMESTAMP
    })
    
    print("-" * 30)
    print(f"✨ 保存完了！Firebaseの 'determined_shifts/{doc_id}' に書き込みました。")

else:
    print("❌ 作成失敗。条件を見直してください。")