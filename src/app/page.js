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
  const [dailySales, setDailySales] = useState({});
  const [determinedSchedule, setDeterminedSchedule] = useState({}); // { "1": [{name:"田中", shift:"A"}...], ... }

  // ▼ UI用
  const [selectedDay, setSelectedDay] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRank, setNewStaffRank] = useState("パートナー");

  // 初期化
  useEffect(() => {
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + 1);
    const today = new Date();
    if (today.getDate() >= 20) {
      targetDate.setMonth(targetDate.getMonth() + 1);
    }

    const y = targetDate.getFullYear();
    const m = targetDate.getMonth() + 1;
    setYear(y);
    setMonth(m);
    setDaysInMonth(new Date(y, m, 0).getDate());

    fetchStaffs();
    fetchConfig(y, m);
    fetchDeterminedShift(y, m);
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

  const fetchConfig = async (y, m) => {
    try {
      const docId = `${y}-${m}`; 
      const docSnap = await getDoc(doc(db, "monthlyConfig", docId));
      if (docSnap.exists()) setDailySales(docSnap.data().dailySales || {});
      else setDailySales({});
    } catch (e) { console.log("Config fetch error"); }
  };

  const fetchDeterminedShift = async (y, m) => {
    try {
      const docId = `${y}-${m}`;
      const docSnap = await getDoc(doc(db, "determined_shifts", docId));
      if (docSnap.exists()) {
        setDeterminedSchedule(docSnap.data().schedule || {});
      } else {
        setDeterminedSchedule({});
      }
    } catch (e) { console.log("Determined shift fetch error"); }
  };

  const saveSalesConfig = async () => {
    const docId = `${year}-${month}`;
    try {
      await setDoc(doc(db, "monthlyConfig", docId), { dailySales, updatedAt: new Date() }, { merge: true });
      alert("売上設定を保存しました");
    } catch (e) { alert("保存失敗"); }
  };

  const handleSalesChange = (day, value) => {
    setDailySales(prev => ({ ...prev, [day]: value }));
  };

  const handleAddStaff = async () => {
    if (!newStaffName) return;
    const rankMap = { "店長": 1, "リーダー": 2, "社員": 3, "パートナー": 4, "新規パートナー": 5 };
    try {
      await addDoc(collection(db, "staffs"), { 
        name: newStaffName, rank: newStaffRank, rankId: rankMap[newStaffRank] || 99,
        canClose: false, skills: { fridge: 0, washing: 0, ac: 0, tv: 0, mobile: 0, pc: 0 }
      });
      setNewStaffName(""); fetchStaffs();
    } catch (error) { alert("登録失敗"); }
  };

  const toggleCanClose = async (staff) => {
    const newVal = !staff.canClose;
    setStaffs(prev => prev.map(s => s.id === staff.id ? { ...s, canClose: newVal } : s));
    await updateDoc(doc(db, "staffs", staff.id), { canClose: newVal });
  };

  const openSkillModal = (staff) => {
    setEditingStaff({ ...staff });
    setSkillModalOpen(true);
  };

  const saveSkills = async () => {
    if (!editingStaff) return;
    try {
      await updateDoc(doc(db, "staffs", editingStaff.id), { skills: editingStaff.skills });
      setSkillModalOpen(false); fetchStaffs();
    } catch (e) { alert("スキル保存失敗"); }
  };

  const handleSkillClick = (key, num) => {
    setEditingStaff(prev => {
      const currentVal = prev.skills?.[key] || 0;
      return { ...prev, skills: { ...prev.skills, [key]: (currentVal === num) ? 0 : num } };
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

  // ▼▼▼ シフト表示変換用（A→早） ▼▼▼
  const shiftLabel = (code) => {
    if(code === "A") return "早";
    if(code === "B") return "中";
    if(code === "C") return "遅";
    return code || "";
  };

  // ▼▼▼ CSVダウンロード機能（Excel用） ▼▼▼
  const downloadCSV = () => {
    // 1. ヘッダーを作る: 名前, 役職, 1, 2, 3 ...
    let csvContent = "\uFEFF"; // Excelで文字化けしないおまじない(BOM)
    const header = ["名前", "役職", ...[...Array(daysInMonth)].map((_,i)=>`${i+1}日`)];
    csvContent += header.join(",") + "\n";

    // 2. スタッフごとに行を作る
    staffs.forEach(staff => {
      const row = [staff.name, staff.rank];
      for(let d=1; d<=daysInMonth; d++) {
        const d_str = str(d);
        // その日のシフトを探す
        const dayData = determinedSchedule[d_str] || [];
        const myShift = dayData.find(s => s.staffId === staff.id);
        row.push(myShift ? shiftLabel(myShift.shift) : ""); // シフトがあれば入れる、なければ空
      }
      csvContent += row.join(",") + "\n";
    });

    // 3. ダウンロード発火
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${year}年${month}月シフト表.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 font-sans text-gray-800 pb-20">
      <div className="max-w-6xl mx-auto bg-white shadow-lg rounded-xl overflow-hidden min-h-[600px] relative">
        
        <div className="bg-blue-600 p-4 text-white text-center shadow-md sticky top-0 z-10 flex justify-between items-center">
          <h1 className="text-xl font-bold flex-1">
            {year}年 {month}月 シフト{isAdmin ? "管理" : "提出"}
          </h1>
          {isAdmin && (
             <button onClick={() => setIsAdmin(false)} className="text-sm bg-blue-800 px-3 py-1 rounded hover:bg-blue-900">
               ログアウト
             </button>
          )}
        </div>

        <div className="p-4">
          {!isAdmin && (
            // --- 一般スタッフ画面 (変更なし) ---
            <div className="max-w-md mx-auto">
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

              {Object.keys(determinedSchedule).length > 0 && (
                <div className="mb-4 p-2 bg-green-100 text-green-800 text-xs font-bold text-center rounded">
                  🎉 シフトが確定しました！
                </div>
              )}

              <div className="grid grid-cols-7 gap-1 mb-6 text-center text-sm select-none">
                {['日','月','火','水','木','金','土'].map((d,i) => (
                  <div key={i} className={`font-bold py-1 ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-400'}`}>{d}</div>
                ))}
                {[...Array(daysInMonth)].map((_, i) => {
                  const d = i + 1; const d_str = str(d);
                  let displayText = ""; let isDetermined = false;
                  if (selectedStaffId && determinedSchedule[d_str]) {
                     const myShift = determinedSchedule[d_str].find(item => item.staffId === selectedStaffId);
                     if (myShift) { displayText = `★${shiftLabel(myShift.shift)}`; isDetermined = true; }
                  }
                  const req = requests[d];
                  let bg="bg-white", txt="text-gray-700", bd="border-gray-200";
                  if (isDetermined) { bg="bg-yellow-100"; txt="text-yellow-700 font-bold"; bd="border-yellow-400"; }
                  else if (req) {
                      if(req.type==="希望休") { bg="bg-red-100"; txt="text-red-600 font-bold"; bd="border-red-200"; }
                      else if(req.type==="有給") { bg="bg-pink-100"; txt="text-pink-600 font-bold"; bd="border-pink-200"; }
                      else { bg="bg-blue-100"; txt="text-blue-700 font-bold"; bd="border-blue-200"; }
                      displayText = req.type.substring(0,2);
                  }
                  return (
                    <div key={d} onClick={() => !isDetermined && handleDateClick(d)}
                      className={`aspect-square border rounded flex flex-col justify-center items-center cursor-pointer ${bg} ${bd}`}
                    >
                      <span className="text-sm">{d}</span>
                      {displayText && <span className="text-[10px]">{displayText}</span>}
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
            // --- 管理者画面 (大幅アップデート: マトリクス表示) ---
            <div>
              <div className="mb-8">
                <div className="flex justify-between items-end mb-2">
                   <h2 className="font-bold text-lg text-gray-700">📅 シフト全体表</h2>
                   {Object.keys(determinedSchedule).length > 0 && (
                     <button 
                       onClick={downloadCSV}
                       className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded shadow flex items-center gap-2"
                     >
                       📄 Excel用CSVをダウンロード
                     </button>
                   )}
                </div>
                
                {/* マトリクス・テーブル表示 */}
                <div className="overflow-x-auto border rounded-lg shadow-sm">
                  <table className="min-w-full bg-white text-xs text-center border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600">
                        <th className="p-2 border whitespace-nowrap sticky left-0 bg-gray-100 z-10">名前</th>
                        {[...Array(daysInMonth)].map((_, i) => (
                          <th key={i} className={`p-1 border min-w-[24px] ${i%7===0?'text-red-500':(i+1)%7===0?'text-blue-500':''}`}>
                            {i+1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {staffs.map((staff) => (
                        <tr key={staff.id} className="hover:bg-gray-50">
                          <td className="p-2 border font-bold text-left whitespace-nowrap sticky left-0 bg-white z-10">
                            {staff.name} <span className="text-[10px] text-gray-400 font-normal">({staff.rank})</span>
                          </td>
                          {[...Array(daysInMonth)].map((_, i) => {
                             const d_str = str(i+1);
                             const dayData = determinedSchedule[d_str] || [];
                             const myShift = dayData.find(s => s.staffId === staff.id);
                             // 表示文字の決定
                             let cellText = "";
                             let cellClass = "";
                             if (myShift) {
                               cellText = shiftLabel(myShift.shift);
                               if(cellText==="早") cellClass="text-blue-600 font-bold bg-blue-50";
                               if(cellText==="中") cellClass="text-green-600 font-bold bg-green-50";
                               if(cellText==="遅") cellClass="text-orange-600 font-bold bg-orange-50";
                             }
                             return (
                               <td key={i} className={`border h-8 ${cellClass}`}>
                                 {cellText}
                               </td>
                             );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {Object.keys(determinedSchedule).length === 0 && (
                  <p className="text-center text-gray-400 mt-4 py-8 bg-gray-50 rounded">まだシフトが計算されていません</p>
                )}
              </div>

              {/* 設定エリア（2カラムレイアウト） */}
              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-bold text-sm text-yellow-800">💰 前年売上入力 ({month}月)</h3>
                    <button onClick={saveSalesConfig} className="bg-yellow-600 text-white px-3 py-1 rounded text-xs font-bold shadow">保存</button>
                  </div>
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
                              type="number" className="w-full text-center border-b border-yellow-200 focus:outline-none bg-transparent" placeholder="0"
                              value={dailySales[d] || ""} onChange={(e) => handleSalesChange(d, e.target.value)}
                            />
                          </div>
                        );
                     })}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="p-4 rounded bg-gray-50 border">
                    <h3 className="font-bold text-sm mb-2">👤 スタッフ追加</h3>
                    <div className="flex flex-wrap gap-2">
                      <input type="text" placeholder="名前" className="border p-2 rounded flex-1 min-w-[120px]" value={newStaffName} onChange={e=>setNewStaffName(e.target.value)} />
                      <select className="border p-2 rounded" value={newStaffRank} onChange={e=>setNewStaffRank(e.target.value)}>
                        <option>店長</option><option>リーダー</option><option>社員</option><option>パートナー</option><option>新規パートナー</option>
                      </select>
                      <button onClick={handleAddStaff} className="bg-green-600 text-white p-2 rounded font-bold text-sm">追加</button>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold text-sm mb-2">登録スタッフ一覧</h3>
                    <div className="space-y-2 h-64 overflow-y-auto border p-2 rounded bg-white">
                      {staffs.map((s) => (
                        <div key={s.id} className="bg-white p-2 border-b flex items-center justify-between text-sm">
                          <div>
                            <div className="font-bold">{s.name} <span className="text-xs font-normal text-gray-500">({s.rank})</span></div>
                            <div className="flex gap-2 mt-1">
                              <button onClick={() => toggleCanClose(s)} className={`text-[10px] px-2 py-0.5 rounded border ${s.canClose ? 'bg-indigo-100 text-indigo-700 border-indigo-300' : 'bg-gray-100 text-gray-400'}`}>締め: {s.canClose?'OK':'NG'}</button>
                              <button onClick={() => openSkillModal(s)} className="text-[10px] bg-gray-100 px-2 py-0.5 rounded border hover:bg-gray-200">スキル設定</button>
                            </div>
                          </div>
                          <button onClick={async()=>{if(confirm("削除しますか？")) { await deleteDoc(doc(db,"staffs",s.id)); fetchStaffs(); }}} className="text-red-400 text-xs px-2">削除</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
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

        {/* --- モーダル類（変更なし） --- */}
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
                          <button key={num} onClick={() => handleSkillClick(key, num)} className={`w-8 h-8 rounded border text-sm transition-colors ${currentVal === num ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>{num}</button>
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

function str(n) { return String(n); }