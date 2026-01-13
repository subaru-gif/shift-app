import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import pandas as pd
from datetime import datetime

# 1. Firebaseに接続
if not firebase_admin._apps:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
db = firestore.client()

# 設定：計算したい年月（Webで入力した月と同じにしてください）
TARGET_YEAR = 2026
TARGET_MONTH = 2
DAYS_IN_MONTH = 28 # ※2月なのでとりあえず28（後で自動化します）

print(f"🤖 AIデータ読み込み開始: {TARGET_YEAR}年{TARGET_MONTH}月")
print("-" * 40)

# 2. 売上設定（予算）を取得
config_ref = db.collection("monthlyConfig").document(f"{TARGET_YEAR}-{TARGET_MONTH}")
config = config_ref.get()
daily_sales = {}
if config.exists:
    daily_sales = config.to_dict().get("dailySales", {})
    print("✅ 売上設定: 読み込み成功")
else:
    print("⚠️ 売上設定が見つかりません（デフォルト値を使います）")

# 3. スタッフとシフト希望をまとめて取得
# まず全員のリストを作る
staffs = {doc.id: doc.to_dict() for doc in db.collection("staffs").stream()}
print(f"✅ スタッフリスト: {len(staffs)}名")

# 次に提出されたシフト希望を取得
shifts = db.collection("shifts").where("year", "==", TARGET_YEAR).where("month", "==", TARGET_MONTH).stream()

# データを整理する箱
# request_map["1日"]["スタッフID"] = "早番" みたいな形にする
request_map = {str(d): {} for d in range(1, DAYS_IN_MONTH + 1)}

for s in shifts:
    data = s.to_dict()
    sid = data["staffId"]
    # その人の希望データ（requests: {"1": {type: "早番"}, ...}）
    user_requests = data.get("requests", {})
    
    for day, req in user_requests.items():
        if day in request_map:
            # タイプ（早番、希望休など）を保存
            request_map[day][sid] = req.get("type", "不明")

# 4. 状況を診断して表示（ここがAIの視点！）
print("-" * 40)
print("📅 日別状況レポート")
print("-" * 40)

# 人件費の目安（適当に、売上の30%を時給1200円で割ったとする）
# 売上 10万円 → 3万円分 → 約25時間働ける
HOURLY_WAGE = 1200
LABOR_COST_RATIO = 0.3

for day in range(1, 6): # 全部出すと長いので最初の5日間だけ表示
    d_str = str(day)
    
    # 予算計算
    sales = int(daily_sales.get(d_str, 0)) # 売上(万円)
    sales_yen = sales * 10000
    budget_hours = (sales_yen * LABOR_COST_RATIO) / HOURLY_WAGE
    
    # 人員状況
    requests_today = request_map.get(d_str, {})
    staff_names = []
    
    for sid, r_type in requests_today.items():
        s_name = staffs[sid]["name"]
        staff_names.append(f"{s_name}({r_type})")
    
    print(f"【{day}日】 売上予測: {sales}万円")
    print(f"   💰 確保可能時間: 約{int(budget_hours)}時間")
    print(f"   🙋 応募スタッフ: {len(staff_names)}人 -> {', '.join(staff_names)}")
    
    if len(staff_names) == 0:
        print("   ⚠️ 誰も希望を出していません！")
    elif int(budget_hours) == 0 and len(staff_names) > 0:
        print("   ⚠️ 売上設定が0なのに人が集まっています（赤字注意）")
    print("")

print("-" * 40)
print("診断完了。このデータを元にシフトを組みます。")