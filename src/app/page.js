"use client";
import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
// 必要な機能をインポート（データ取得、追加、削除）
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy } from "firebase/firestore";

export default function Home() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);
  
  // ▼ スタッフ管理用
  const [staffs, setStaffs] = useState([]); // 登録されたスタッフ一覧
  const [selectedStaffId, setSelectedStaffId] = useState(""); // プルダウンで選ばれた人のID
  const [newStaffName, setNewStaffName] = useState(""); // 新規登録する名前
  const [newStaffRank, setNewStaffRank] = useState("パートナー"); // 新規登録するランク

  // ▼ 初期化（日付設定 & スタッフ一覧取得）
  useEffect(() => {
    const today = new Date();
    if (today.getDate() >= 15) {
      today.setMonth(today.getMonth() + 1);
    }
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);

    // スタッフ一覧をデータベースから取ってくる
    fetchStaffs();
  }, []);

  // データベースからスタッフ一覧を読み込む関数
  const fetchStaffs = async () => {
    try {
      // ランク順とかに並べたいけど一旦登録順
      const q = query(collection(db, "staffs"), orderBy("rankId", "asc")); 
      const querySnapshot = await getDocs(q);
      const list = [];
      querySnapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setStaffs(list);
    } catch (e) {
      // まだデータがない時はエラーになるかもなので無視
      console.log("まだスタッフがいません");
    }
  };

  // ▼ 管理者ログイン
  const handleLogin = () => {
    if (password === "admin123") {
      setIsAdmin(true);
    } else {
      alert("パスワードが違います");
    }
  };

  // ▼ スタッフ追加（管理者用）
  const handleAddStaff = async () => {
    if (!newStaffName) return;
    
    // ランクの並び順用数値（店長が偉い）
    const rankMap = { "店長": 1, "リーダー": 2, "社員": 3, "パートナー": 4, "新規パートナー": 5 };

    try {
      await addDoc(collection(db, "staffs"), {
        name: newStaffName,
        rank: newStaffRank,
        rankId: rankMap[newStaffRank] || 99
      });
      setNewStaffName("");
      alert(`${newStaffName}さんを登録しました`);
      fetchStaffs(); // リストを再読み込み
    } catch (error) {
      console.error(error);
      alert("登録失敗");
    }
  };

  // ▼ スタッフ削除（管理者用）
  const handleDeleteStaff = async (id, name) => {
    if(!confirm(`${name}さんを削除しますか？`)) return;
    try {
      await deleteDoc(doc(db, "staffs", id));
      fetchStaffs();
    } catch (error) {
      alert("削除失敗");
    }
  };

  // ▼ シフト提出（テスト用）
  const handleSubmit = async () => {
    if (!selectedStaffId) {
      alert("名前を選択してください！");
      return;
    }

    // IDから名前を探す
    const staff = staffs.find(s => s.id === selectedStaffId);

    try {
      await addDoc(collection(db, "shifts"), {
        name: staff.name,
        rank: staff.rank,
        year: year,
        month: month,
        createdAt: new Date(),
        message: "スタッフ選択式で送信成功！"
      });
      alert(`✅ ${staff.name}さんのシフト希望を送信しました（テスト）`);
    } catch (error) {
      console.error(error);
      alert("送信エラー");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 font-sans text-gray-800">
      <div className="max-w-md mx-auto bg-white shadow-lg rounded-xl overflow-hidden">
        
        <div className="bg-blue-600 p-4 text-white text-center">
          <h1 className="text-xl font-bold">
            {year}年 {month}月 シフト{isAdmin ? "管理" : "提出"}
          </h1>
        </div>

        <div className="p-6">
          {/* ▼▼▼ 一般スタッフ画面 ▼▼▼ */}
          {!isAdmin && (
            <div>
              {/* 1. 名前選択（一番上に配置） */}
              <div className="mb-6 bg-blue-50 p-4 rounded-lg border border-blue-100">
                <label className="block text-sm font-bold mb-2 text-blue-800">
                  誰のシフトですか？
                </label>
                <select 
                  className="w-full p-3 border rounded-lg bg-white shadow-sm"
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                >
                  <option value="">▼ 名前を選択してください</option>
                  {staffs.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} ({staff.rank})
                    </option>
                  ))}
                </select>
                {staffs.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">
                    ※管理者がまだスタッフを登録していません
                  </p>
                )}
              </div>

              <p className="mb-4 text-sm text-gray-600">
                希望シフトを選択してください。<br/>
                <span className="text-red-500 text-xs">※締切: 20日まで</span>
              </p>
              
              {/* カレンダー（まだ見た目だけ） */}
              <div className="grid grid-cols-7 gap-1 mb-6 text-center text-sm">
                {['日','月','火','水','木','金','土'].map(d => (
                  <div key={d} className="font-bold text-gray-400">{d}</div>
                ))}
                {[...Array(30)].map((_, i) => (
                  <div key={i} className="border p-2 rounded text-gray-300">
                    {i + 1}
                  </div>
                ))}
              </div>

              <button 
                onClick={handleSubmit}
                className={`w-full py-3 rounded-lg font-bold transition ${selectedStaffId ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                disabled={!selectedStaffId}
              >
                シフトを提出する
              </button>

              {/* 管理者メニューへの入り口 */}
              <div className="mt-8 pt-4 border-t text-right">
                <details className="text-xs text-gray-400">
                  <summary className="cursor-pointer list-none">管理者メニュー</summary>
                  <div className="mt-2 flex gap-2 justify-end">
                    <input 
                      type="password" 
                      placeholder="pass" 
                      className="border p-1 rounded w-20"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button 
                      onClick={handleLogin}
                      className="bg-gray-700 text-white px-2 rounded"
                    >
                      入室
                    </button>
                  </div>
                </details>
              </div>
            </div>
          )}

          {/* ▼▼▼ 管理者画面（スタッフ登録機能を追加） ▼▼▼ */}
          {isAdmin && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-bold text-lg">管理者設定</h2>
                <button 
                  onClick={() => setIsAdmin(false)}
                  className="text-xs text-blue-600 underline"
                >
                  ログアウト
                </button>
              </div>

              {/* スタッフ登録フォーム */}
              <div className="mb-8 border p-4 rounded-lg bg-gray-50">
                <h3 className="font-bold text-sm mb-3">👤 スタッフ登録</h3>
                <div className="flex gap-2 mb-2">
                  <input 
                    type="text" 
                    placeholder="名前" 
                    className="border p-2 rounded flex-1"
                    value={newStaffName}
                    onChange={(e) => setNewStaffName(e.target.value)}
                  />
                  <select 
                    className="border p-2 rounded"
                    value={newStaffRank}
                    onChange={(e) => setNewStaffRank(e.target.value)}
                  >
                    <option>店長</option>
                    <option>リーダー</option>
                    <option>社員</option>
                    <option>パートナー</option>
                    <option>新規パートナー</option>
                  </select>
                </div>
                <button 
                  onClick={handleAddStaff}
                  className="w-full bg-green-600 text-white p-2 rounded hover:bg-green-700 font-bold text-sm"
                >
                  追加する
                </button>
              </div>

              {/* 登録済みスタッフ一覧 */}
              <div>
                <h3 className="font-bold text-sm mb-2">登録済みリスト ({staffs.length}名)</h3>
                <ul className="space-y-2">
                  {staffs.map((s) => (
                    <li key={s.id} className="flex justify-between items-center bg-white p-2 border rounded shadow-sm">
                      <span>{s.name} <span className="text-xs text-gray-500">({s.rank})</span></span>
                      <button 
                        onClick={() => handleDeleteStaff(s.id, s.name)}
                        className="text-red-500 text-xs border border-red-200 px-2 py-1 rounded hover:bg-red-50"
                      >
                        削除
                      </button>
                    </li>
                  ))}
                  {staffs.length === 0 && <li className="text-gray-400 text-sm">まだ登録がありません</li>}
                </ul>
              </div>
              
            </div>
          )}
        </div>
      </div>
    </div>
  );
}