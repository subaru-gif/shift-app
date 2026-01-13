"use client";
import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, query, orderBy, setDoc, getDoc } from "firebase/firestore";

export default function Home() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);
  const [daysInMonth, setDaysInMonth] = useState(30);
  
  // ▼ データ関連
  const [staffs, setStaffs] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [requests, setRequests] = useState({});
  // 売上設定（日別） { "1": 100, "2": 80 ... }
  const [dailySales, setDailySales] = useState({}); 

  // ▼ UI用
  const [selectedDay, setSelectedDay] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  
  // ▼ 管理者入力用
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRank, setNewStaffRank] = useState("パートナー");

  // 初期化
  useEffect(() => {
    // 日付ロジック：基本は来月。20日を過ぎたら再来月。
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + 1); // まず来月にする
    
    const today = new Date();
    if (today.getDate() >= 20) {
      targetDate.setMonth(targetDate.getMonth() + 1); // 20日過ぎならもう1ヶ月進める
    }

    const y = targetDate.getFullYear();
    const m = targetDate.getMonth() + 1;
    setYear(y);
    setMonth(m);
    setDaysInMonth(new Date(y, m, 0).getDate());

    fetchStaffs();
    fetchConfig(y, m);
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

  // 月ごとの設定（日別売上）を取得
  const fetchConfig = async (y, m) => {
    try {
      const docId = `${y}-${m}`; 
      const docRef = doc(db, "monthlyConfig", docId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        setDailySales(data.dailySales || {});
      } else {
        // データがない（月が変わった）場合は空っぽでスタート
        setDailySales({});
      }
    } catch (e) { console.log("Config fetch error"); }
  };

  // ▼ 売上設定を保存
  const saveSalesConfig = async () => {
    const docId = `${year}-${month}`;
    try {
      // dailyConfigとして保存
      await setDoc(doc(db, "monthlyConfig", docId), { 
        dailySales: dailySales,
        updatedAt: new Date()
      }, { merge: true });
      alert("売上設定を保存しました");
    } catch (e) { alert("保存失敗"); }
  };

  // ▼ 売上入力欄の変更ハンドラ
  const handleSalesChange = (day, value) => {
    setDailySales(prev => ({
      ...prev,
      [day]: value // 文字列のまま保持、計算時にNumberにする
    }));
  };

  // ▼ スタッフ追加
  const handleAddStaff = async () => {
    if (!newStaffName) return;
    const rankMap = { "店長": 1, "リーダー": 2, "社員": 3, "パートナー": 4, "新規パートナー": 5 };
    try {
      await addDoc(collection(db, "staffs"), { 
        name: newStaffName, 
        rank: newStaffRank, 
        rankId: rankMap[newStaffRank] || 99,
        canClose: false,
        skills: { fridge: 0, washing: 0, ac: 0, tv: 0, mobile: 0, pc: 0 } // 初期値0
      });
      setNewStaffName(""); 
      fetchStaffs();
    } catch (error) { alert("登録失敗"); }
  };

  // ▼ 締め作業OK/NG
  const toggleCanClose = async (staff) => {
    const newVal = !staff.canClose;
    setStaffs(prev => prev.map(s => s.id === staff.id ? { ...s, canClose: newVal } : s));
    await updateDoc(doc(db, "staffs", staff.id), { canClose: newVal });
  };

  const openSkillModal = (staff) => {
    setEditingStaff({ ...staff });
    setSkillModalOpen(true);
  };

  // ▼ スキル保存
  const saveSkills = async () => {
    if (!editingStaff) return;
    try {
      await updateDoc(doc(db, "staffs", editingStaff.id), { skills: editingStaff.skills });
      setSkillModalOpen(false);
      fetchStaffs();
    } catch (e) { alert("スキル保存失敗"); }
  };

  // ▼ スキル値のトグル処理（同じ値なら0にする）
  const handleSkillClick = (key, num) => {
    setEditingStaff(prev => {
      const currentVal = prev.skills?.[key] || 0;
      const newVal = (currentVal === num) ? 0 : num; // 同じなら0、違えばその数字
      return {
        ...prev,
        skills: { ...prev.skills, [key]: newVal }
      };
    });
  };

  const handleDateClick = (day) => {
    if (!selectedStaffId) { alert("先に名前を選択してください"); return; }
    setSelectedDay(day); setModalOpen(true);
  };

  const saveRequest = (type, start = "", end = "") => {
    setRequests(prev => ({ ...prev, [selectedDay]: { type, start, end } }));
    setModalOpen(false);
  };

  const removeRequest = () => {
    setRequests(prev => { const d = { ...prev }; delete d[selectedDay]; return d; });
    setModalOpen(false);
  };

  const handleSubmit = async () => {
    if (!selectedStaffId || Object.keys(requests).length === 0) { alert("入力がありません"); return; }
    const staff = staffs.find(s => s.id === selectedStaffId);
    if(!confirm(`${staff.name}さんのシフトを提出しますか？`)) return;
    try {
      await addDoc(collection(db, "shifts"), {
        staffId: staff.id, name: staff.name, rank: staff.rank, year, month, requests, createdAt: new Date()
      });
      alert("✅ 提出完了！"); setRequests({}); setSelectedStaffId("");
    } catch (e) { alert("エラー"); }
  };

  const handleLogin = () => {
    if (password === "333191") setIsAdmin(true); else alert("パスワードが違います");
  };

  const currentStaff = staffs.find(s => s.id === selectedStaffId);
  const isEmployee = currentStaff && ["店長", "リーダー", "社員"].includes(currentStaff.rank);

  return (
    <div className="min-h-screen bg-gray-50 p-4 font-sans text-gray-800 pb-20">
      <div className="max-w-md mx-auto bg-white shadow-lg rounded-xl overflow-hidden min-h-[600px] relative">
        
        {/* ヘッダー */}
        <div className="bg-blue-600 p-4 text-white text-center shadow-md sticky top-0 z-10">
          <h1 className="text-xl font-bold">
            {year}年 {month}月 シフト{isAdmin ? "管理" : "提出"}
          </h1>
        </div>

        <div className="p-4">
          {!isAdmin && (
            // ▼▼▼ 一般スタッフ用画面 ▼▼▼
            <div>
              <div className="mb-4 bg-blue-50 p-3 rounded-lg border border-blue-100">
                <label className="block text-xs font-bold mb-1 text-blue-800">スタッフ選択</label>
                <select 
                  className="w-full p-2 border border-blue-200 rounded bg-white text-lg"
                  value={selectedStaffId}
                  onChange={(e) => { setSelectedStaffId(e.target.value); setRequests({}); }}
                >
                  <option value="">▼ 選択してください</option>
                  {staffs.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.rank})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-6 text-center text-sm select-none">
                {['日','月','火','水','木','金','土'].map((d,i) => (
                  <div key={i} className={`font-bold py-1 ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-400'}`}>{d}</div>
                ))}
                {[...Array(daysInMonth)].map((_, i) => {
                  const d = i + 1; const req = requests[d];
                  let bg="bg-white", txt="text-gray-700", bd="border-gray-200";
                  if(req) {
                    if(req.type==="希望休") { bg="bg-red-100"; txt="text-red-600 font-bold"; bd="border-red-200"; }
                    else if(req.type==="有給") { bg="bg-pink-100"; txt="text-pink-600 font-bold"; bd="border-pink-200"; }
                    else { bg="bg-blue-100"; txt="text-blue-700 font-bold"; bd="border-blue-200"; }
                  }
                  return (
                    <div key={d} onClick={() => handleDateClick(d)}
                      className={`aspect-square border rounded flex flex-col justify-center items-center cursor-pointer ${bg} ${bd}`}
                    >
                      <span className="text-sm">{d}</span>
                      {req && <span className="text-[10px]">{req.type.substring(0,2)}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="fixed bottom-0 left-0 w-full p-4 bg-white border-t z-20">
                <div className="max-w-md mx-auto">
                    <button onClick={handleSubmit} disabled={!selectedStaffId} className={`w-full py-3 rounded-lg font-bold text-white shadow-lg ${selectedStaffId?'bg-blue-600':'bg-gray-300'}`}>提出する</button>
                </div>
              </div>
            </div>
          )}

          {isAdmin && (
            // ▼▼▼ 管理者用画面 ▼▼▼
            <div>
              <div className="flex justify-between items-center mb-6 border-b pb-2">
                <h2 className="font-bold text-lg">管理者設定</h2>
                <button onClick={() => setIsAdmin(false)} className="text-xs text-blue-600 underline">ログアウト</button>
              </div>

              {/* 1. 日別売上設定 (カレンダー形式) */}
              <div className="mb-8 bg-yellow-50 p-4 rounded border border-yellow-200">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-bold text-sm text-yellow-800">💰 前年売上入力 ({month}月)</h3>
                  <button onClick={saveSalesConfig} className="bg-yellow-600 text-white px-3 py-1 rounded text-xs font-bold shadow">保存する</button>
                </div>
                <p className="text-[10px] text-gray-500 mb-2">※日別の売上(万円)を入力してください</p>
                
                <div className="grid grid-cols-7 gap-1 text-center text-xs">
                   {['日','月','火','水','木','金','土'].map((d,i) => (
                      <div key={i} className={`font-bold ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-400'}`}>{d}</div>
                   ))}
                   {[...Array(daysInMonth)].map((_, i) => {
                      const d = i + 1;
                      return (
                        <div key={d} className="bg-white border rounded p-1 flex flex-col items-center">
                          <span className="text-gray-400 mb-1">{d}</span>
                          <input 
                            type="number" 
                            className="w-full text-center border-b border-yellow-200 focus:border-yellow-500 focus:outline-none text-gray-700 font-bold bg-transparent"
                            placeholder="0"
                            value={dailySales[d] || ""}
                            onChange={(e) => handleSalesChange(d, e.target.value)}
                          />
                        </div>
                      );
                   })}
                </div>
              </div>

              {/* 2. スタッフ登録 */}
              <div className="mb-6 p-4 rounded bg-gray-50 border">
                <h3 className="font-bold text-sm mb-2">👤 スタッフ追加</h3>
                <div className="flex flex-wrap gap-2">
                  <input type="text" placeholder="名前" className="border p-2 rounded flex-1 min-w-[120px]" value={newStaffName} onChange={e=>setNewStaffName(e.target.value)} />
                  <select className="border p-2 rounded" value={newStaffRank} onChange={e=>setNewStaffRank(e.target.value)}>
                    <option>店長</option><option>リーダー</option><option>社員</option><option>パートナー</option><option>新規パートナー</option>
                  </select>
                  <button onClick={handleAddStaff} className="bg-green-600 text-white p-2 rounded font-bold text-sm">追加</button>
                </div>
              </div>

              {/* 3. スタッフリスト */}
              <h3 className="font-bold text-sm mb-2">登録スタッフ一覧</h3>
              <div className="space-y-2 pb-10">
                {staffs.map((s) => (
                  <div key={s.id} className="bg-white p-3 border rounded shadow-sm flex items-center justify-between">
                    <div>
                      <div className="font-bold">{s.name} <span className="text-xs font-normal bg-gray-100 px-1 rounded">{s.rank}</span></div>
                      <div className="flex gap-2 mt-1">
                        <button 
                          onClick={() => toggleCanClose(s)}
                          className={`text-xs px-2 py-0.5 rounded border ${s.canClose ? 'bg-indigo-100 text-indigo-700 border-indigo-300' : 'bg-gray-100 text-gray-400'}`}
                        >
                          締め: {s.canClose ? 'OK' : 'NG'}
                        </button>
                        <button onClick={() => openSkillModal(s)} className="text-xs bg-gray-100 px-2 py-0.5 rounded border hover:bg-gray-200">
                          スキル設定
                        </button>
                      </div>
                    </div>
                    <button onClick={async()=>{if(confirm("削除しますか？")) { await deleteDoc(doc(db,"staffs",s.id)); fetchStaffs(); }}} className="text-red-400 text-xs px-2">削除</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {!isAdmin && (
             <div className="mt-12 text-right">
                <details className="text-xs text-gray-300">
                  <summary className="list-none cursor-pointer p-2">Admin</summary>
                  <div className="flex gap-1 justify-end p-2">
                    <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="border rounded w-16" />
                    <button onClick={handleLogin} className="bg-gray-400 text-white px-2 rounded">Go</button>
                  </div>
                </details>
             </div>
          )}
        </div>

        {/* ▼▼▼ 入力モーダル（シフト希望） ▼▼▼ */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setModalOpen(false)}>
            <div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4 text-center border-b pb-2">{month}/{selectedDay} の希望</h3>
              {isEmployee ? (
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={()=>saveRequest("希望休")} className="bg-red-100 text-red-700 py-3 rounded-lg font-bold">希望休</button>
                  <button onClick={()=>saveRequest("有給")} className="bg-pink-100 text-pink-700 py-3 rounded-lg font-bold">有給休暇</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={()=>saveRequest("早番","09:30","19:00")} className="bg-blue-100 text-blue-800 py-2 rounded font-bold text-sm">早番(A)</button>
                    <button onClick={()=>saveRequest("中番","11:00","20:30")} className="bg-blue-100 text-blue-800 py-2 rounded font-bold text-sm">中番(B)</button>
                    <button onClick={()=>saveRequest("遅番","12:00","21:30")} className="bg-blue-100 text-blue-800 py-2 rounded font-bold text-sm">遅番(C)</button>
                  </div>
                  <div className="border-t pt-3 mt-2">
                    <p className="text-xs text-gray-500 mb-1">時間指定</p>
                    <div className="flex items-center gap-2 mb-3">
                      <input type="time" id="startTime" defaultValue="09:30" className="border p-1 rounded bg-gray-50"/>
                      <span>～</span>
                      <input type="time" id="endTime" defaultValue="15:00" className="border p-1 rounded bg-gray-50"/>
                    </div>
                    <button onClick={()=>{const s=document.getElementById("startTime").value;const e=document.getElementById("endTime").value;saveRequest("時間指定",s,e);}} className="w-full bg-gray-800 text-white py-2 rounded font-bold">時間を決定</button>
                  </div>
                </div>
              )}
              <button onClick={removeRequest} className="w-full mt-6 py-2 border border-gray-300 text-gray-500 rounded">クリア</button>
            </div>
          </div>
        )}

        {/* ▼▼▼ スキル設定モーダル（トグル対応） ▼▼▼ */}
        {skillModalOpen && editingStaff && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={()=>setSkillModalOpen(false)}>
            <div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4 text-center border-b pb-2">{editingStaff.name}さんのスキル</h3>
              <div className="space-y-3">
                {['fridge:冷蔵庫', 'washing:洗濯機', 'ac:エアコン', 'tv:TV', 'mobile:携帯', 'pc:PC'].map((item) => {
                  const [key, label] = item.split(':');
                  const currentVal = editingStaff.skills?.[key] || 0;
                  return (
                    <div key={key} className="flex justify-between items-center">
                      <span className="text-sm font-bold">{label}</span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(num => (
                          <button
                            key={num}
                            onClick={() => handleSkillClick(key, num)}
                            className={`w-8 h-8 rounded border text-sm transition-colors ${currentVal === num ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                          >
                            {num}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={()=>setSkillModalOpen(false)} className="flex-1 py-2 border rounded">キャンセル</button>
                <button onClick={saveSkills} className="flex-1 py-2 bg-blue-600 text-white rounded font-bold">保存</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}