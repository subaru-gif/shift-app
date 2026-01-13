"use client";
import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy } from "firebase/firestore";

export default function Home() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);
  const [daysInMonth, setDaysInMonth] = useState(30);
  
  // ▼ スタッフ・シフト関連
  const [staffs, setStaffs] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  
  // ▼ 提出データ（{ "1": { type: "希望休" }, "2": { type: "出勤", start: "09:30", end: "19:00" } } みたいな形）
  const [requests, setRequests] = useState({});
  
  // ▼ ポップアップ用
  const [selectedDay, setSelectedDay] = useState(null); // 何日を選んでいるか
  const [modalOpen, setModalOpen] = useState(false);
  
  // ▼ 管理者用フォーム
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRank, setNewStaffRank] = useState("パートナー");

  // 初期化
  useEffect(() => {
    const today = new Date();
    if (today.getDate() >= 15) {
      today.setMonth(today.getMonth() + 1);
    }
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    setYear(y);
    setMonth(m);
    
    // その月が何日まであるか計算
    setDaysInMonth(new Date(y, m, 0).getDate());

    fetchStaffs();
  }, []);

  const fetchStaffs = async () => {
    try {
      const q = query(collection(db, "staffs"), orderBy("rankId", "asc")); 
      const querySnapshot = await getDocs(q);
      const list = [];
      querySnapshot.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      setStaffs(list);
    } catch (e) { console.log("Error fetching staffs"); }
  };

  // ▼ カレンダーの日付クリック時の処理
  const handleDateClick = (day) => {
    if (!selectedStaffId) {
      alert("先に名前を選択してください");
      return;
    }
    setSelectedDay(day);
    setModalOpen(true);
  };

  // ▼ シフト希望をメモリ上に保存する
  const saveRequest = (type, start = "", end = "") => {
    setRequests(prev => ({
      ...prev,
      [selectedDay]: { type, start, end }
    }));
    setModalOpen(false);
  };

  // ▼ シフト希望を削除する
  const removeRequest = () => {
    setRequests(prev => {
      const newData = { ...prev };
      delete newData[selectedDay];
      return newData;
    });
    setModalOpen(false);
  };

  // ▼ 最終送信（Firebaseへ保存）
  const handleSubmit = async () => {
    if (!selectedStaffId || Object.keys(requests).length === 0) {
      alert("シフト希望が入力されていません");
      return;
    }
    const staff = staffs.find(s => s.id === selectedStaffId);

    if(!confirm(`${staff.name}さんのシフトを提出しますか？`)) return;

    try {
      await addDoc(collection(db, "shifts"), {
        staffId: staff.id,
        name: staff.name,
        rank: staff.rank,
        year,
        month,
        requests: requests, // 入力データをまるごと保存
        createdAt: new Date(),
      });
      alert("✅ 提出しました！お疲れ様でした。");
      setRequests({}); // リセット
      setSelectedStaffId("");
    } catch (error) {
      console.error(error);
      alert("送信エラーが発生しました");
    }
  };

  // 現在選択中のスタッフ情報を取得
  const currentStaff = staffs.find(s => s.id === selectedStaffId);
  // 社員ランクかどうか判定
  const isEmployee = currentStaff && ["店長", "リーダー", "社員"].includes(currentStaff.rank);

  return (
    <div className="min-h-screen bg-gray-50 p-4 font-sans text-gray-800 pb-20">
      <div className="max-w-md mx-auto bg-white shadow-lg rounded-xl overflow-hidden min-h-[600px] relative">
        
        {/* ヘッダー */}
        <div className="bg-blue-600 p-4 text-white text-center shadow-md z-10 relative">
          <h1 className="text-xl font-bold tracking-wider">
            {year}年 {month}月 シフト{isAdmin ? "管理" : "提出"}
          </h1>
        </div>

        <div className="p-4">
          {!isAdmin && (
            <div>
              {/* 名前選択 */}
              <div className="mb-4 bg-blue-50 p-3 rounded-lg border border-blue-100 shadow-sm">
                <label className="block text-xs font-bold mb-1 text-blue-800">
                  スタッフ選択
                </label>
                <select 
                  className="w-full p-2 border border-blue-200 rounded bg-white text-lg"
                  value={selectedStaffId}
                  onChange={(e) => {
                    setSelectedStaffId(e.target.value);
                    setRequests({}); // 人を変えたら入力内容はリセット
                  }}
                >
                  <option value="">▼ 選択してください</option>
                  {staffs.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.rank})</option>
                  ))}
                </select>
              </div>

              {/* ガイドメッセージ */}
              {currentStaff && (
                <p className="mb-2 text-xs text-center text-gray-500">
                  {isEmployee 
                    ? "休み希望の日をタップしてください（有給/希望休）"
                    : "出勤できる日をタップして時間を入力してください"
                  }
                </p>
              )}
              
              {/* ▼ インタラクティブ・カレンダー */}
              <div className="grid grid-cols-7 gap-1 mb-6 text-center text-sm select-none">
                {['日','月','火','水','木','金','土'].map((d,i) => (
                  <div key={i} className={`font-bold py-1 ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-400'}`}>{d}</div>
                ))}
                
                {[...Array(daysInMonth)].map((_, i) => {
                  const d = i + 1;
                  const req = requests[d]; // その日の入力データ
                  
                  // マスの色決め
                  let bgClass = "bg-white";
                  let textClass = "text-gray-700";
                  let borderClass = "border-gray-200";

                  if (req) {
                    if (req.type === "希望休") {
                      bgClass = "bg-red-100"; textClass = "text-red-600 font-bold"; borderClass = "border-red-200";
                    } else if (req.type === "有給") {
                      bgClass = "bg-pink-100"; textClass = "text-pink-600 font-bold"; borderClass = "border-pink-200";
                    } else {
                      // 出勤系
                      bgClass = "bg-blue-100"; textClass = "text-blue-700 font-bold"; borderClass = "border-blue-200";
                    }
                  }

                  return (
                    <div 
                      key={d} 
                      onClick={() => handleDateClick(d)}
                      className={`
                        aspect-square border rounded flex flex-col justify-center items-center cursor-pointer transition relative
                        ${bgClass} ${borderClass} hover:brightness-95 active:scale-95
                      `}
                    >
                      <span className="text-sm">{d}</span>
                      {/* 入力内容の簡易表示 */}
                      {req && (
                        <span className="text-[10px] leading-tight">
                          {req.type === "時間指定" ? `${req.start}~` : req.type.substring(0,2)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 提出ボタン */}
              <div className="fixed bottom-0 left-0 w-full p-4 bg-white border-t z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                <div className="max-w-md mx-auto">
                    <button 
                        onClick={handleSubmit}
                        disabled={!selectedStaffId}
                        className={`w-full py-3 rounded-lg font-bold text-white shadow-lg transition
                        ${selectedStaffId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'}`}
                    >
                        シフトを提出する
                    </button>
                </div>
              </div>
            </div>
          )}

          {/* 管理者画面 */}
          {isAdmin && (
            <div>
              <div className="flex justify-between items-center mb-6 border-b pb-2">
                <h2 className="font-bold text-lg">管理者設定</h2>
                <button onClick={() => setIsAdmin(false)} className="text-xs text-blue-600 underline">ログアウト</button>
              </div>

              {/* スタッフ登録 (UI修正: flex-wrap追加) */}
              <div className="mb-8 p-4 rounded-lg bg-gray-50 border">
                <h3 className="font-bold text-sm mb-3">👤 スタッフ登録</h3>
                <div className="flex flex-wrap gap-2 mb-2">
                  <input 
                    type="text" placeholder="名前" className="border p-2 rounded flex-1 min-w-[120px]"
                    value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)}
                  />
                  <select 
                    className="border p-2 rounded min-w-[100px]"
                    value={newStaffRank} onChange={(e) => setNewStaffRank(e.target.value)}
                  >
                    <option>店長</option>
                    <option>リーダー</option>
                    <option>社員</option>
                    <option>パートナー</option>
                    <option>新規パートナー</option>
                  </select>
                </div>
                <button 
                  onClick={async () => {
                    if (!newStaffName) return;
                    const rankMap = { "店長": 1, "リーダー": 2, "社員": 3, "パートナー": 4, "新規パートナー": 5 };
                    await addDoc(collection(db, "staffs"), { name: newStaffName, rank: newStaffRank, rankId: rankMap[newStaffRank] || 99 });
                    setNewStaffName(""); fetchStaffs();
                  }}
                  className="w-full bg-green-600 text-white p-2 rounded font-bold text-sm"
                >
                  追加する
                </button>
              </div>
              
              <div className="text-sm">
                 <p>※登録リストは省略（機能は生きています）</p>
              </div>
            </div>
          )}
          
          {/* 管理者ログイン入り口 */}
          {!isAdmin && (
             <div className="mt-12 text-right">
                <details className="text-xs text-gray-300">
                  <summary className="list-none cursor-pointer p-2">Admin</summary>
                  <div className="flex gap-1 justify-end p-2">
                    <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="border rounded w-16" />
                    <button onClick={() => password==="admin123" && setIsAdmin(true)} className="bg-gray-400 text-white px-2 rounded">Go</button>
                  </div>
                </details>
             </div>
          )}
        </div>

        {/* ▼▼▼ 入力モーダル（ポップアップ） ▼▼▼ */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
            <div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4 text-center border-b pb-2">
                {month}/{selectedDay} の希望
              </h3>

              {/* ▼ 社員ランク用の選択肢 */}
              {isEmployee ? (
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => saveRequest("希望休")} className="bg-red-100 text-red-700 py-3 rounded-lg font-bold hover:bg-red-200">
                    希望休
                  </button>
                  <button onClick={() => saveRequest("有給")} className="bg-pink-100 text-pink-700 py-3 rounded-lg font-bold hover:bg-pink-200">
                    有給休暇
                  </button>
                </div>
              ) : (
                /* ▼ パートナー用の選択肢 */
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => saveRequest("早番", "09:30", "19:00")} className="bg-blue-100 text-blue-800 py-2 rounded font-bold text-sm">早番(A)</button>
                    <button onClick={() => saveRequest("中番", "11:00", "20:30")} className="bg-blue-100 text-blue-800 py-2 rounded font-bold text-sm">中番(B)</button>
                    <button onClick={() => saveRequest("遅番", "12:00", "21:30")} className="bg-blue-100 text-blue-800 py-2 rounded font-bold text-sm">遅番(C)</button>
                  </div>
                  
                  <div className="border-t pt-3 mt-2">
                    <p className="text-xs text-gray-500 mb-1">時間指定入力</p>
                    <div className="flex items-center gap-2 mb-3">
                      <input type="time" id="startTime" defaultValue="09:30" className="border p-1 rounded bg-gray-50" />
                      <span>～</span>
                      <input type="time" id="endTime" defaultValue="15:00" className="border p-1 rounded bg-gray-50" />
                    </div>
                    <button 
                        onClick={() => {
                            const s = document.getElementById("startTime").value;
                            const e = document.getElementById("endTime").value;
                            saveRequest("時間指定", s, e);
                        }}
                        className="w-full bg-gray-800 text-white py-2 rounded font-bold"
                    >
                        時間を決定
                    </button>
                  </div>
                </div>
              )}

              <button onClick={removeRequest} className="w-full mt-6 py-2 border border-gray-300 text-gray-500 rounded hover:bg-gray-100">
                設定をクリア（空白）
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}