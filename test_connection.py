import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore

# さっきダウンロードした鍵を使ってログイン
cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)

db = firestore.client()

print("🔥 Firebaseに接続しました！")
print("-" * 30)

# 1. スタッフ一覧を取得してみる
print("【スタッフリスト】")
staffs = db.collection("staffs").stream()
for s in staffs:
    data = s.to_dict()
    print(f"- {data['name']} ({data['rank']})")

print("-" * 30)

# 2. 売上設定を取得してみる（開発中の2月分）
month_config = db.collection("monthlyConfig").document("2026-2").get()
if month_config.exists:
    sales = month_config.to_dict().get("targetSales", 0)
    print(f"💰 2026年2月の目標売上: {sales}万円")
else:
    print("💰 2026年2月の売上設定はまだありません")

print("-" * 30)
print("テスト完了。データが見えていればOKです！")