"use client";
import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, query, orderBy, setDoc, getDoc, where, writeBatch } from "firebase/firestore";

export default function Home() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");

  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);
  const [daysInMonth, setDaysInMonth] = useState(30);

  const [activeTab, setActiveTab] = useState("input");

  // ▼ データ
  const [staffs, setStaffs] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [requests, setRequests] = useState({});
  const [allRequests, setAllRequests] = useState([]);
  const [dailySales, setDailySales] = useState({});
  const [determinedSchedule, setDeterminedSchedule] = useState({});
  const [meetingSchedule, setMeetingSchedule] = useState({});

  // ▼ 設定
  const [configCaps, setConfigCaps] = useState({ salesLow: 100, hoursLow: 70, salesHigh: 500, hoursHigh: 100 });
  const [minSkills, setMinSkills] = useState({ fridge: 0, washing: 0, ac: 0, tv: 0, mobile: 0, pc: 0 });
  const [minStaffCounts, setMinStaffCounts] = useState({ open: 3, close: 3 });

  // ▼ UI用
  const [selectedDay, setSelectedDay] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [skillDetailModalOpen, setSkillDetailModalOpen] = useState(false);
  const [selectedSkillDetail, setSelectedSkillDetail] = useState(null);
  const [editingStaff, setEditingStaff] = useState(null);
  const [previewRequestModalOpen, setPreviewRequestModalOpen] = useState(false);
  const [previewRequestData, setPreviewRequestData] = useState(null);

  // 管理者修正用の一時ステート
  const [editingRequests, setEditingRequests] = useState({});

  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffRank, setNewStaffRank] = useState("パートナー");
  const [newStaffDept, setNewStaffDept] = useState("家電");
  const [bulkMaxDays, setBulkMaxDays] = useState(22);

  const [customStart, setCustomStart] = useState("09:30");
  const [customEnd, setCustomEnd] = useState("15:00");
  const [isPaidLeaveSelected, setIsPaidLeaveSelected] = useState(false);
  const [isFreeSelected, setIsFreeSelected] = useState(false);

  const skillLabelMap = {
    fridge: "冷蔵庫", washing: "洗濯機", ac: "エアコン", tv: "TV", mobile: "携帯", pc: "PC"
  };

  // --- 日付切り替え ---
  useEffect(() => {
    const today = new Date();
    let targetY = today.getFullYear();
    let targetM = today.getMonth() + 1;

    if (isAdmin) {
      if (today.getDate() >= 10) targetM += 1;
    } else {
      if (today.getDate() >= 25) targetM += 2;
      else targetM += 1;
    }

    const dateObj = new Date(targetY, targetM - 1, 1);
    const finalYear = dateObj.getFullYear();
    const finalMonth = dateObj.getMonth() + 1;

    setYear(finalYear);
    setMonth(finalMonth);
    setDaysInMonth(new Date(finalYear, finalMonth, 0).getDate());

  }, [isAdmin]);

  // --- データ読み込み ---
  useEffect(() => { fetchStaffs(); }, []);

  useEffect(() => {
    if (!isAdmin && selectedStaffId && year && month) {
      fetchPersonalRequest(selectedStaffId, year, month);
    }
  }, [selectedStaffId, year, month, isAdmin]);

  useEffect(() => {
    if (isAdmin && year && month) {
      fetchConfig(year, month);
      fetchDeterminedShift(year, month);
      fetchAllRequests(year, month);
    }
  }, [isAdmin, year, month]);

  const fetchStaffs = async () => {
    try {
      const q = query(collection(db, "staffs"), orderBy("rankId", "asc"));
      const snap = await getDocs(q);
      const list = [];
      snap.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
      setStaffs(list);
    } catch (e) { console.log("Error fetching staffs"); }
  };

  const fetchPersonalRequest = async (staffId, y, m) => {
    try {
      const q = query(collection(db, "shifts"), where("staffId", "==", staffId), where("year", "==", y), where("month", "==", m));
      const snap = await getDocs(q);
      if (!snap.empty) {
        setRequests(snap.docs[0].data().requests || {});
      } else {
        setRequests({});
      }
    } catch (e) { console.log("Personal fetch error"); }
  };

  const fetchConfig = async (y, m) => {
    try {
      const docId = `${y}-${m}`;
      const snap = await getDoc(doc(db, "monthlyConfig", docId));
      if (snap.exists()) {
        const data = snap.data();
        setDailySales(data.dailySales || {});
        setConfigCaps(data.caps || { salesLow: 100, hoursLow: 70, salesHigh: 500, hoursHigh: 100 });
        setMinSkills(data.minSkills || { fridge: 0, washing: 0, ac: 0, tv: 0, mobile: 0, pc: 0 });
        setMinStaffCounts(data.minStaffCounts || { open: 3, close: 3 });
        setMeetingSchedule(data.meetings || {});
      } else {
        setDailySales({});
        setMeetingSchedule({});
      }
    } catch (e) { console.log("Config fetch error"); }
  };

  const fetchDeterminedShift = async (y, m) => {
    try {
      const docId = `${y}-${m}`;
      const snap = await getDoc(doc(db, "determined_shifts", docId));
      if (snap.exists()) setDeterminedSchedule(snap.data().schedule || {});
      else setDeterminedSchedule({});
    } catch (e) { console.log("Determined shift fetch error"); }
  };

  const fetchAllRequests = async (y, m) => {
    try {
      const q = query(collection(db, "shifts"), where("year", "==", y), where("month", "==", m));
      const snap = await getDocs(q);
      const list = [];
      snap.forEach(doc => list.push(doc.data()));
      setAllRequests(list);
    } catch (e) { console.log("Requests fetch error"); }
  }

  const saveConfig = async () => {
    const docId = `${year}-${month}`;
    try {
      await setDoc(doc(db, "monthlyConfig", docId), {
        dailySales, caps: configCaps, minSkills, minStaffCounts, meetings: meetingSchedule, updatedAt: new Date()
      }, { merge: true });
      alert("設定を保存しました");
    } catch (e) { alert("保存失敗"); }
  };

  const handleSalesChange = (day, value) => setDailySales(prev => ({ ...prev, [day]: value }));

  const handleAddStaff = async () => {
    if (!newStaffName) return;
    const rankMap = { "店長": 1, "リーダー": 2, "社員": 3, "パートナー": 4, "新規パートナー": 5 };
    try {
      await addDoc(collection(db, "staffs"), {
        name: newStaffName, rank: newStaffRank, rankId: rankMap[newStaffRank] || 99,
        department: newStaffDept, maxDays: 22, priority: "2",
        canOpen: false, canClose: false,
        skills: { fridge: 0, washing: 0, ac: 0, tv: 0, mobile: 0, pc: 0 }
      });
      setNewStaffName(""); fetchStaffs();
    } catch (error) { alert("登録失敗"); }
  };

  const handleBulkUpdateMaxDays = async () => {
    if (!confirm(`全スタッフの上限日数を ${bulkMaxDays}日 に更新しますか？`)) return;
    try {
      const batch = writeBatch(db);
      staffs.forEach(s => {
        const ref = doc(db, "staffs", s.id);
        batch.update(ref, { maxDays: Number(bulkMaxDays) });
      });
      await batch.commit();
      fetchStaffs();
      alert("更新しました");
    } catch (e) { alert("更新失敗"); }
  };

  const toggleKeyStatus = async (staff, type) => {
    const newVal = !staff[type];
    setStaffs(prev => prev.map(s => s.id === staff.id ? { ...s, [type]: newVal } : s));
    await updateDoc(doc(db, "staffs", staff.id), { [type]: newVal });
  };

  const updateStaffParam = async (staff, key, val) => {
    let updateData = { [key]: val };
    if (key === "rank") {
      const rankMap = { "店長": 1, "リーダー": 2, "社員": 3, "パートナー": 4, "新規パートナー": 5 };
      updateData.rankId = rankMap[val] || 99;
    }
    setStaffs(prev => prev.map(s => s.id === staff.id ? { ...s, ...updateData } : s));
    await updateDoc(doc(db, "staffs", staff.id), updateData);
  };

  const openSkillModal = (staff) => { setEditingStaff({ ...staff }); setSkillModalOpen(true); };
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

  const showSkillDetails = (key) => {
    const list = staffs.filter(s => (s.skills?.[key] || 0) > 0)
      .map(s => ({ name: s.name, val: s.skills[key] }))
      .sort((a, b) => b.val - a.val);
    setSelectedSkillDetail({ key, list });
    setSkillDetailModalOpen(true);
  };

  const roundTime = (val, setter) => {
    if (!val) return;
    const [h, m] = val.split(":");
    let min = parseInt(m, 10);
    if (min < 15) min = "00";
    else if (min < 45) min = "30";
    else min = "00";
    setter(`${h}:${min}`);
  };

  const handleTimeChange = (e, setter) => {
    setter(e.target.value);
  }

  const formatTime = (t) => {
    if (!t) return "";
    const [h, m] = t.split(":");
    return parseInt(h) + (m === "30" ? "半" : "");
  };

  const getWorkHours = (shiftCode, start, end) => {
    if (["A", "B", "C"].includes(shiftCode)) return 8;
    if (shiftCode === "M" || shiftCode === "会議" || shiftCode === "有給") return 0;
    if (shiftCode === "時間指定" && start && end) {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);
      let diff = (eh + em / 60) - (sh + sm / 60);
      if (diff > 6) diff -= 1;
      return diff > 0 ? diff : 0;
    }
    return 0;
  };

  const getShiftDisplay = (shiftCode, start, end) => {
    if (shiftCode === "A") return "早";
    if (shiftCode === "B") return "中";
    if (shiftCode === "C") return "遅";
    if (shiftCode === "M") return "議";
    if (shiftCode === "会議") return "議";
    if (shiftCode === "有給") return "有";
    if (shiftCode === "希望休") return "希";
    if (shiftCode === "フリー") return "全";

    if ((shiftCode === "時間指定" || !["A", "B", "C", "M", "会議", "有給", "希望休", "フリー"].includes(shiftCode)) && start && end) {
      const [sh, sm] = start.split(":").map(Number);
      const [eh, em] = end.split(":").map(Number);

      if (sh === 9 && sm === 30 && eh === 19 && em === 0) return "早";
      if (sh === 11 && sm === 0 && eh === 20 && em === 30) return "中";
      if (sh === 12 && sm === 0 && eh === 21 && em === 30) return "遅";

      return formatTime(start) + formatTime(end);
    }
    return shiftCode || "";
  };

  // ★修正: 並び替えロジック
  // 1. 店長 (RankId=1) は部門関係なく最優先
  // 2. その後は部門順 (季節 > 家電 > 情報 > 通信)
  // 3. 同じ部門なら役職順
  const getSortedStaffs = () => {
    const deptOrder = { "季節": 1, "家電": 2, "情報": 3, "通信": 4 };
    return [...staffs].sort((a, b) => {
      // 1. 店長最優先
      if (a.rankId === 1 && b.rankId !== 1) return -1;
      if (a.rankId !== 1 && b.rankId === 1) return 1;

      // 2. 部門順
      const deptA = deptOrder[a.department] || 99;
      const deptB = deptOrder[b.department] || 99;
      if (deptA !== deptB) return deptA - deptB;

      // 3. 役職順
      return a.rankId - b.rankId;
    });
  };

  // 管理者修正用: 日付クリック
  const startAdminEdit = (d) => {
    setSelectedDay(d);
    setIsPaidLeaveSelected(false);
    setIsFreeSelected(false);
    setCustomStart("09:30");
    setCustomEnd("15:00");

    // editingRequests (一時編集用) から取得
    const req = editingRequests[d];
    if (req) {
      if (req.type === "時間指定") {
        setCustomStart(req.start);
        setCustomEnd(req.end);
      } else if (req.type === "有給") {
        setIsPaidLeaveSelected(true);
      } else if (req.type === "フリー") {
        setIsFreeSelected(true);
      }
    }
    setModalOpen(true);
  };

  // 管理者: プレビューを開く
  const openPreview = (reqData) => {
    setPreviewRequestData(reqData);
    setEditingRequests(reqData.requests || {}); // 一時ステートにコピー
    setPreviewRequestModalOpen(true);
  }

  // 一般スタッフ用: 日付クリック
  const handleDateClick = (day) => {
    if (!selectedStaffId) { alert("先に名前を選択してください"); return; }
    setSelectedDay(day);
    const existing = requests[day];
    setIsPaidLeaveSelected(false);
    setIsFreeSelected(false);
    setCustomStart("09:30");
    setCustomEnd("15:00");

    if (existing) {
      if (existing.type === "時間指定") {
        setCustomStart(existing.start);
        setCustomEnd(existing.end);
      } else if (existing.type === "有給") {
        setIsPaidLeaveSelected(true);
      } else if (existing.type === "フリー") {
        setIsFreeSelected(true);
      }
    }
    setModalOpen(true);
  };

  // モーダル内: 保存 (一般はrequests, 管理者はeditingRequests)
  const saveRequest = (type, start = "", end = "") => {
    if (isAdmin && previewRequestModalOpen) {
      setEditingRequests(prev => ({ ...prev, [selectedDay]: { type, start, end } }));
    } else {
      setRequests(prev => ({ ...prev, [selectedDay]: { type, start, end } }));
    }
    setModalOpen(false);
  };

  const removeRequest = () => {
    if (isAdmin && previewRequestModalOpen) {
      setEditingRequests(prev => { const d = { ...prev }; delete d[selectedDay]; return d; });
    } else {
      setRequests(prev => { const d = { ...prev }; delete d[selectedDay]; return d; });
    }
    setModalOpen(false);
  };

  const handleSubmit = async () => {
    const targetStaffId = isAdmin && previewRequestData ? previewRequestData.staffId : selectedStaffId;
    if (!targetStaffId) return;

    const dataToSave = isAdmin && previewRequestData ? editingRequests : requests;

    const staff = staffs.find(s => s.id === targetStaffId);
    if (!confirm(isAdmin ? `変更を確定して保存しますか？` : `提出しますか？`)) return;

    const q = query(collection(db, "shifts"), where("staffId", "==", staff.id), where("year", "==", year), where("month", "==", month));
    const snap = await getDocs(q);
    snap.forEach(async (d) => { await deleteDoc(doc(db, "shifts", d.id)); });

    await addDoc(collection(db, "shifts"), {
      staffId: staff.id, name: staff.name, rank: staff.rank, year, month, requests: dataToSave, createdAt: new Date()
    });
    alert("✅ 保存しました");

    if (isAdmin) {
      setAllRequests(prev => {
        const filtered = prev.filter(r => r.staffId !== staff.id);
        return [...filtered, { staffId: staff.id, name: staff.name, rank: staff.rank, year, month, requests: dataToSave }];
      });
      setPreviewRequestData({ ...previewRequestData, requests: dataToSave });
      setPreviewRequestModalOpen(false);
    } else {
      setRequests({}); setSelectedStaffId("");
    }
  };

  const handleLogin = () => {
    if (password === "333191") setIsAdmin(true); else alert("パスワードが違います");
  };

  const toggleMeeting = (day, staffId) => {
    setMeetingSchedule(prev => {
      const dayList = prev[day] || [];
      const newList = dayList.includes(staffId) ? dayList.filter(id => id !== staffId) : [...dayList, staffId];
      return { ...prev, [day]: newList };
    });
  };

  const handleCreateShift = async () => {
    if (!confirm("クラウドAIでシフトを作成しますか？")) return;
    try {
      alert("🤖 計算中...");
      await saveConfig();
      const res = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, daysInMonth })
      });
      if (res.ok) {
        const data = await res.json();
        alert("✨ " + data.message);
        window.location.reload();
      } else {
        const err = await res.json();
        alert("❌ 作成失敗: " + (err.error || "エラー"));
      }
    } catch (e) { alert("❌ 通信エラー"); }
  };

  const downloadCSV = () => {
    let csv = "\uFEFF名前,部門,役職," + [...Array(daysInMonth)].map((_, i) => `${i + 1}日`).join(",") + "\n";
    getSortedStaffs().forEach(s => {
      const row = [s.name, s.department, s.rank];
      for (let d = 1; d <= daysInMonth; d++) {
        const dayData = determinedSchedule[String(d)] || [];
        const shift = dayData.find(x => x.staffId === s.id);
        row.push(shift ? getShiftDisplay(shift.shift, shift.start, shift.end) : "");
      }
      csv += row.join(",") + "\n";
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    link.download = "shift.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const currentStaff = staffs.find(s => s.id === selectedStaffId);
  const isEmployee = currentStaff && (currentStaff.rankId <= 3);
  const isPart = currentStaff && !isEmployee;

  const sortedStaffs = getSortedStaffs();

  return (
    <div className="min-h-screen bg-gray-50 p-2 font-sans text-gray-800 pb-20">
      <div className="max-w-[1400px] mx-auto bg-white shadow-xl rounded-xl overflow-hidden">
        <div className="bg-blue-700 p-4 text-white flex justify-between items-center sticky top-0 z-20 shadow">
          <h1 className="text-xl font-bold">{year}年{month}月 シフト{isAdmin ? "管理" : "提出"}</h1>
          {isAdmin && (
            <div className="flex gap-2">
              <button onClick={() => setActiveTab("input")} className={`px-3 py-1 rounded text-xs font-bold ${activeTab === "input" ? 'bg-white text-blue-700' : 'bg-blue-800 text-white'}`}>設定・入力</button>
              <button onClick={() => setActiveTab("shift")} className={`px-3 py-1 rounded text-xs font-bold ${activeTab === "shift" ? 'bg-white text-blue-700' : 'bg-blue-800 text-white'}`}>シフト表・分析</button>
              <button onClick={() => setIsAdmin(false)} className="px-3 py-1 rounded text-xs bg-red-500 hover:bg-red-600">ログアウト</button>
            </div>
          )}
        </div>

        <div className="p-4">
          {!isAdmin && (
            <div className="max-w-md mx-auto">
              <div className="mb-4 bg-blue-50 p-3 rounded border border-blue-100">
                <label className="block text-xs font-bold mb-1 text-blue-800">スタッフ選択</label>
                <select className="w-full p-2 border rounded bg-white" value={selectedStaffId} onChange={(e) => { setSelectedStaffId(e.target.value); setRequests({}); }}>
                  <option value="">▼ 選択してください</option>
                  {staffs.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-6 text-center text-sm select-none">
                {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (<div key={i} className={`font-bold py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{d}</div>))}
                {[...Array(new Date(year, month - 1, 1).getDay())].map((_, i) => <div key={`empty-${i}`} className="aspect-square border border-transparent"></div>)}
                {[...Array(daysInMonth)].map((_, i) => {
                  const d = i + 1; const req = requests[d];
                  let bg = "bg-white", txt = "text-gray-700", bd = "border-gray-200", disp = "";
                  if (req) {
                    if (req.type === "希望休") { bg = "bg-red-100"; txt = "text-red-600 font-bold"; bd = "border-red-200"; }
                    else if (req.type === "有給") { bg = "bg-pink-100"; txt = "text-pink-600 font-bold"; bd = "border-pink-200"; }
                    else if (req.type === "フリー") { bg = "bg-green-100"; txt = "text-green-700 font-bold"; bd = "border-green-200"; }
                    else { bg = "bg-blue-100"; txt = "text-blue-700 font-bold"; bd = "border-blue-200"; }
                    disp = getShiftDisplay(req.type, req.start, req.end);
                  }
                  return (
                    <div key={d} onClick={() => handleDateClick(d)} className={`aspect-square border rounded flex flex-col justify-center items-center cursor-pointer ${bg} ${bd}`}>
                      <span className="text-sm">{d}</span>
                      {disp && <span className="text-[10px]">{disp}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="fixed bottom-0 left-0 w-full p-4 bg-white border-t z-20">
                <button onClick={handleSubmit} disabled={!selectedStaffId} className={`w-full py-3 rounded-lg font-bold text-white shadow-lg ${selectedStaffId ? 'bg-blue-600' : 'bg-gray-300'}`}>提出する</button>
              </div>
            </div>
          )}

          {isAdmin && activeTab === "input" && (
            <div className="grid lg:grid-cols-2 gap-8">
              {/* (省略なし: 左カラム) */}
              <div className="space-y-6">
                <div className="bg-white p-4 rounded border shadow-sm">
                  <h3 className="font-bold text-sm mb-4">📈 スタッフ総スキル保有量</h3>
                  <div className="flex gap-4 items-end h-32 border-b cursor-pointer" title="タップして内訳を確認">
                    {Object.keys(minSkills).map(k => {
                      const total = staffs.reduce((acc, s) => acc + (s.skills?.[k] || 0), 0);
                      return (
                        <div key={k} className="flex-1 flex flex-col items-center gap-1 group" onClick={() => showSkillDetails(k)}>
                          <span className="text-xs font-bold">{total}</span>
                          <div className="w-full bg-blue-200 rounded-t hover:bg-blue-300 transition-all" style={{ height: `${Math.min(total * 2, 100)}px` }}></div>
                          <span className="text-[10px] text-gray-500">{skillLabelMap[k]}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="bg-yellow-50 p-4 rounded border border-yellow-200 shadow-sm">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-bold text-sm text-yellow-800">💰 売上・労働時間キャップ</h3>
                    <button onClick={saveConfig} className="bg-yellow-600 text-white px-3 py-1 rounded text-xs font-bold">保存</button>
                  </div>
                  <div className="text-xs space-y-2 mb-4">
                    <div className="flex gap-2 items-center">
                      <span>売上</span><input type="number" className="w-16 border rounded p-1" value={configCaps.salesLow} onChange={e => setConfigCaps({ ...configCaps, salesLow: Number(e.target.value) })} />
                      <span>万円以下 →</span><input type="number" className="w-12 border rounded p-1" value={configCaps.hoursLow} onChange={e => setConfigCaps({ ...configCaps, hoursLow: Number(e.target.value) })} /><span>時間</span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <span>売上</span><input type="number" className="w-16 border rounded p-1" value={configCaps.salesHigh} onChange={e => setConfigCaps({ ...configCaps, salesHigh: Number(e.target.value) })} />
                      <span>万円以下 →</span><input type="number" className="w-12 border rounded p-1" value={configCaps.hoursHigh} onChange={e => setConfigCaps({ ...configCaps, hoursHigh: Number(e.target.value) })} /><span>時間</span>
                    </div>
                  </div>
                  <hr className="border-yellow-200 my-2" />
                  <h4 className="font-bold text-xs text-yellow-800 mb-2">日別売上予算</h4>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs">
                    {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (<div key={i} className="font-bold text-gray-400">{d}</div>))}
                    {[...Array(new Date(year, month - 1, 1).getDay())].map((_, i) => <div key={`empty-${i}`}></div>)}
                    {[...Array(daysInMonth)].map((_, i) => (
                      <div key={i + 1}>
                        <span className="block text-[9px] text-gray-400">{i + 1}日</span>
                        <input type="number" className="w-full text-center border rounded focus:outline-none focus:border-yellow-500" placeholder="0" value={dailySales[i + 1] || ""} onChange={(e) => handleSalesChange(i + 1, e.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-indigo-50 p-4 rounded border border-indigo-200 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-bold text-sm text-indigo-800">🧠 設定: 人数・スキル</h3>
                    <button onClick={saveConfig} className="bg-indigo-600 text-white px-2 py-0.5 rounded text-[10px]">更新</button>
                  </div>

                  <div className="mb-4">
                    <p className="text-xs font-bold mb-1 text-indigo-700">開け・締め人数</p>
                    <div className="flex gap-4 text-xs">
                      <div className="flex items-center gap-1 bg-white p-1 rounded border">
                        <span>開け人数:</span>
                        <input type="number" className="w-10 border text-center" value={minStaffCounts.open} onChange={(e) => setMinStaffCounts({ ...minStaffCounts, open: Number(e.target.value) })} />
                        <span>人</span>
                      </div>
                      <div className="flex items-center gap-1 bg-white p-1 rounded border">
                        <span>締め人数:</span>
                        <input type="number" className="w-10 border text-center" value={minStaffCounts.close} onChange={(e) => setMinStaffCounts({ ...minStaffCounts, close: Number(e.target.value) })} />
                        <span>人</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs font-bold mb-1 text-indigo-700">1日の必要最低スキル値</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {Object.keys(minSkills).map(key => (
                      <div key={key} className="flex justify-between items-center bg-white p-2 rounded border">
                        <span>{skillLabelMap[key]}</span>
                        <input type="number" className="w-12 border rounded text-center" value={minSkills[key]} onChange={(e) => setMinSkills({ ...minSkills, [key]: Number(e.target.value) })} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-gray-100 p-4 rounded border">
                  <h3 className="font-bold text-sm mb-2">📩 提出状況 (名前タップで編集)</h3>
                  <div className="flex flex-wrap gap-2">
                    {staffs.map(s => {
                      const req = allRequests.find(r => r.staffId === s.id);
                      return (
                        <button key={s.id}
                          onClick={() => openPreview(req)}
                          className={`px-3 py-1 rounded text-xs border ${req ? 'bg-blue-100 text-blue-800 border-blue-300 font-bold' : 'bg-white text-gray-400'}`}
                        >
                          {s.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* (管理者画面：右カラム) */}
              <div className="space-y-4">
                <div className="p-4 rounded bg-gray-50 border shadow-sm">
                  <h3 className="font-bold text-sm mb-2">👤 スタッフ管理・会議設定</h3>

                  <div className="flex flex-wrap gap-2 mb-4 p-2 bg-white rounded border">
                    <input type="text" placeholder="名前" className="border p-1 rounded flex-1 text-sm" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} />
                    <select className="border p-1 rounded text-sm" value={newStaffRank} onChange={e => setNewStaffRank(e.target.value)}><option>店長</option><option>リーダー</option><option>社員</option><option>パートナー</option><option>新規パートナー</option></select>
                    <select className="border p-1 rounded text-sm" value={newStaffDept} onChange={e => setNewStaffDept(e.target.value)}><option>家電</option><option>季節</option><option>情報</option><option>通信</option><option>-</option></select>
                    <button onClick={handleAddStaff} className="bg-green-600 text-white p-1 px-3 rounded font-bold text-xs">追加</button>
                  </div>

                  <div className="flex items-center gap-2 mb-4 bg-gray-100 p-2 rounded">
                    <span className="text-xs font-bold">上限日数一括:</span>
                    <input type="number" className="w-10 border text-center text-sm" value={bulkMaxDays} onChange={e => setBulkMaxDays(e.target.value)} />
                    <button onClick={handleBulkUpdateMaxDays} className="bg-gray-500 text-white px-2 py-1 rounded text-xs">全更新</button>
                  </div>

                  <div className="space-y-2 h-[600px] overflow-y-auto pr-2">
                    {sortedStaffs.map(s => {
                      const isPart = ["パートナー", "新規パートナー"].includes(s.rank);
                      return (
                        <div key={s.id} className="bg-white p-2 border rounded text-xs">
                          <div className="flex justify-between items-center mb-1">
                            <div className="font-bold text-sm flex gap-1 items-center">
                              {s.name}
                              <select className="text-xs border rounded p-0.5" value={s.rank} onChange={(e) => updateStaffParam(s, 'rank', e.target.value)}>
                                <option>店長</option><option>リーダー</option><option>社員</option><option>パートナー</option><option>新規パートナー</option>
                              </select>
                              <select className="text-xs border rounded p-0.5" value={s.department} onChange={(e) => updateStaffParam(s, 'department', e.target.value)}>
                                <option>家電</option><option>季節</option><option>情報</option><option>通信</option><option>-</option>
                              </select>
                              {isPart && (
                                <select className="text-xs border rounded p-0.5 text-blue-700 font-bold bg-blue-50" value={s.priority || "2"} onChange={(e) => updateStaffParam(s, 'priority', e.target.value)} title="優先度(1:高 2:普 3:低)">
                                  <option value="1">P:1</option><option value="2">P:2</option><option value="3">P:3</option>
                                </select>
                              )}
                            </div>
                            <button onClick={() => deleteDoc(doc(db, "staffs", s.id)).then(fetchStaffs)} className="text-red-400 hover:text-red-600">削除</button>
                          </div>
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className="bg-gray-100 px-1 rounded text-[10px]">上限:</span>
                            <input
                              type="number"
                              className="w-8 border text-center"
                              defaultValue={s.maxDays || 22}
                              onBlur={(e) => updateStaffParam(s, 'maxDays', Number(e.target.value))}
                            />
                            <span className="text-[10px]">日</span>
                            <button onClick={() => toggleKeyStatus(s, 'canOpen')} className={`px-2 py-0.5 rounded border ${s.canOpen ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-400'}`}>鍵開</button>
                            <button onClick={() => toggleKeyStatus(s, 'canClose')} className={`px-2 py-0.5 rounded border ${s.canClose ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-400'}`}>鍵締</button>
                            <button onClick={() => openSkillModal(s)} className="bg-gray-100 px-2 py-0.5 rounded border">スキル</button>
                          </div>
                          <div className="mt-2 pt-1 border-t flex flex-wrap gap-1">
                            <span className="text-gray-400">会議:</span>
                            {[...Array(daysInMonth)].map((_, i) => {
                              const d = String(i + 1);
                              const isMeeting = meetingSchedule[d]?.includes(s.id);
                              return (<button key={d} onClick={() => toggleMeeting(d, s.id)} className={`w-5 h-5 flex items-center justify-center rounded text-[9px] ${isMeeting ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-300'}`}>{d}</button>)
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 管理者：シフト表・分析タブ */}
          {isAdmin && activeTab === "shift" && (
            <div>
              <div className="flex justify-between items-end mb-4">
                <h2 className="font-bold text-lg text-gray-700">📊 シフト分析・出力</h2>
                <div className="flex gap-2">
                  <button onClick={handleCreateShift} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded shadow text-sm">⚡ クラウドでシフト作成</button>
                  {Object.keys(determinedSchedule).length > 0 && (
                    <button onClick={downloadCSV} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded shadow flex items-center gap-2 text-sm">📄 CSV</button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto border rounded-lg shadow-sm mb-8 bg-white">
                <table className="min-w-full text-xs text-center border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600">
                      <th className="p-2 border whitespace-nowrap sticky left-0 bg-gray-100 z-10 w-40">項目 / 日付</th>
                      {[...Array(daysInMonth)].map((_, i) => (<th key={i} className={`p-1 border w-10 ${new Date(year, month - 1, i + 1).getDay() === 0 ? 'text-red-500' : new Date(year, month - 1, i + 1).getDay() === 6 ? 'text-blue-500' : ''}`}>{i + 1}</th>))}
                    </tr>
                    <tr className="bg-blue-50 font-bold">
                      <td className="p-1 border sticky left-0 bg-blue-50 text-left">総労働時間</td>
                      {[...Array(daysInMonth)].map((_, i) => {
                        const d = String(i + 1);
                        const workers = determinedSchedule[d] || [];
                        const totalH = workers.reduce((acc, w) => acc + getWorkHours(w.shift, w.start, w.end), 0);
                        return <td key={i} className="border">{totalH > 0 ? Math.round(totalH) : "-"}</td>
                      })}
                    </tr>
                    {["家電", "季節", "情報", "通信"].map(dept => (
                      <tr key={dept} className="bg-gray-50 text-gray-500">
                        <td className="p-1 border sticky left-0 bg-gray-50 text-left text-[10px]">{dept}時間</td>
                        {[...Array(daysInMonth)].map((_, i) => {
                          const d = String(i + 1);
                          const workers = determinedSchedule[d] || [];
                          const deptH = workers.filter(w => staffs.find(s => s.id === w.staffId)?.department === dept)
                            .reduce((acc, w) => acc + getWorkHours(w.shift, w.start, w.end), 0);
                          return <td key={i} className="border text-[10px]">{deptH > 0 ? Math.round(deptH) : ""}</td>
                        })}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {sortedStaffs.map((s, index) => {
                      // 部門が変わるタイミングで太線
                      const prevDept = index > 0 ? sortedStaffs[index - 1].department : null;
                      const isDeptChanged = index > 0 && s.department !== prevDept;
                      const borderClass = isDeptChanged ? "border-t-4 border-black" : "";

                      // スタッフ個人の希望データを取得 (表示用)
                      const staffReqData = allRequests.find(r => r.staffId === s.id);

                      return (
                        <tr key={s.id} className={`hover:bg-gray-50 ${borderClass}`}>
                          <td className="p-2 border font-bold text-left whitespace-nowrap sticky left-0 bg-white z-10 w-40 truncate">
                            {s.name}
                            <span className="text-[9px] text-gray-400 ml-1">
                              ({s.rank === "新規パートナー" ? "新人" : s.rank})
                            </span>
                          </td>
                          {[...Array(daysInMonth)].map((_, i) => {
                            const d = String(i + 1);
                            const shift = (determinedSchedule[d] || []).find(x => x.staffId === s.id);
                            const req = staffReqData?.requests?.[d];

                            let disp = "", cls = "";

                            if (shift) {
                              // AIが決めたシフトがある場合
                              disp = getShiftDisplay(shift.shift, shift.start, shift.end);
                              if (disp === "早") cls = "text-blue-600 font-bold bg-blue-50";
                              if (disp === "中") cls = "text-green-600 font-bold bg-green-50";
                              if (disp === "遅") cls = "text-orange-600 font-bold bg-orange-50";
                              if (disp === "議") cls = "text-purple-600 font-bold bg-purple-50";
                              if (disp.length > 2) cls = "text-xs text-gray-600 bg-gray-50 font-bold";
                            } else if (req) {
                              // シフトがない場合、希望（有給・希望休）を表示
                              if (req.type === "有給") {
                                disp = "有";
                                cls = "text-pink-600 font-bold bg-pink-50";
                              } else if (req.type === "希望休") {
                                disp = "希";
                                cls = "text-red-400 font-bold bg-red-50";
                              }
                            }

                            return <td key={i} className={`border h-8 ${cls}`}>{disp}</td>;
                          })}
                        </tr>
                      )
                    })}
                    {/* 以下、集計行 */}
                    <tr className="bg-gray-100 font-bold border-t-2">
                      <td className="p-2 border sticky left-0 bg-gray-100">日別スキル充足</td>
                      {[...Array(daysInMonth)].map((_, i) => {
                        const d = String(i + 1);
                        const workers = determinedSchedule[d] || [];
                        let isLack = false;
                        Object.keys(minSkills).forEach(k => {
                          if (minSkills[k] > 0) {
                            const sum = workers.reduce((acc, w) => acc + (staffs.find(s => s.id === w.staffId)?.skills?.[k] || 0), 0);
                            if (sum < minSkills[k]) isLack = true;
                          }
                        });
                        return <td key={i} className={`border ${isLack ? 'bg-red-200 text-red-800' : 'text-green-600'}`}>{isLack ? '⚠' : 'OK'}</td>
                      })}
                    </tr>
                    {Object.keys(minSkills).map(k => (
                      <tr key={k} className="text-xs text-gray-500">
                        <td className="p-1 border sticky left-0 bg-white text-left">{skillLabelMap[k]} ({minSkills[k]})</td>
                        {[...Array(daysInMonth)].map((_, i) => {
                          const d = String(i + 1);
                          const workers = determinedSchedule[d] || [];
                          const sum = workers.reduce((acc, w) => acc + (staffs.find(s => s.id === w.staffId)?.skills?.[k] || 0), 0);
                          const isLack = minSkills[k] > 0 && sum < minSkills[k];
                          return <td key={i} className={`border ${isLack ? 'text-red-500 font-bold' : ''}`}>{sum}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!isAdmin && <div className="mt-12 text-right"><details className="text-xs text-gray-300"><summary className="cursor-pointer">Admin</summary><input type="password" value={password} onChange={e => setPassword(e.target.value)} className="border rounded w-16" /><button onClick={handleLogin}>Go</button></details></div>}
        </div>

        {/* モーダル類 */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
            <div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4 text-center border-b pb-2">{month}/{selectedDay} の{isAdmin ? `${staffs.find(s => s.id === selectedStaffId)?.name}の` : ""}希望</h3>

              {isEmployee ? (
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => saveRequest("希望休")} className="bg-red-100 text-red-700 py-3 rounded-lg font-bold">希望休</button>
                  <button onClick={() => saveRequest("有給")} className="bg-pink-100 text-pink-700 py-3 rounded-lg font-bold">有給休暇</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => saveRequest("早番", "09:30", "19:00")} className="bg-blue-100 text-blue-800 py-2 rounded font-bold text-sm">早番(A)</button>
                    <button onClick={() => saveRequest("中番", "11:00", "20:30")} className="bg-blue-100 text-blue-800 py-2 rounded font-bold text-sm">中番(B)</button>
                    <button onClick={() => saveRequest("遅番", "12:00", "21:30")} className="bg-blue-100 text-blue-800 py-2 rounded font-bold text-sm">遅番(C)</button>
                  </div>
                  <div className="border-t pt-3 mt-2">
                    <p className="text-xs text-gray-500 mb-1">時間指定 (00/30分)</p>
                    <div className="flex items-center gap-2 mb-3">
                      <button onClick={() => { setIsFreeSelected(!isFreeSelected); if (!isFreeSelected) { setIsPaidLeaveSelected(false); } }} className={`px-2 py-1 rounded text-xs font-bold border ${isFreeSelected ? 'bg-green-500 text-white border-green-600' : 'bg-white text-green-500 border-green-300'}`}>フリー</button>
                      <input type="time" value={customStart} onChange={e => handleTimeChange(e, setCustomStart)} onBlur={e => roundTime(e.target.value, setCustomStart)} className={`border p-1 rounded ${isPaidLeaveSelected || isFreeSelected ? 'bg-gray-200 text-gray-400' : 'bg-gray-50'}`} disabled={isPaidLeaveSelected || isFreeSelected} />
                      <span>～</span>
                      <input type="time" value={customEnd} onChange={e => handleTimeChange(e, setCustomEnd)} onBlur={e => roundTime(e.target.value, setCustomEnd)} className={`border p-1 rounded ${isPaidLeaveSelected || isFreeSelected ? 'bg-gray-200 text-gray-400' : 'bg-gray-50'}`} disabled={isPaidLeaveSelected || isFreeSelected} />
                      <button onClick={() => { setIsPaidLeaveSelected(!isPaidLeaveSelected); if (!isPaidLeaveSelected) { setIsFreeSelected(false); } }} className={`px-2 py-1 rounded text-xs font-bold border ${isPaidLeaveSelected ? 'bg-pink-500 text-white border-pink-600' : 'bg-white text-pink-500 border-pink-300'}`}>有給</button>
                    </div>
                    <button onClick={() => { if (isPaidLeaveSelected) saveRequest("有給"); else if (isFreeSelected) saveRequest("フリー"); else saveRequest("時間指定", customStart, customEnd); }} className={`w-full py-2 rounded font-bold text-white ${isPaidLeaveSelected ? 'bg-pink-500' : isFreeSelected ? 'bg-green-500' : 'bg-gray-800'}`}>{isPaidLeaveSelected ? "有給で決定" : isFreeSelected ? "フリーで決定" : "決定 (閉じる)"}</button>
                  </div>
                </div>
              )}
              {/* コピー機能（すでに入力している日の設定を呼び出す） */}
              {!isAdmin && Object.keys(requests).length > 0 && (
                <div className="mb-4">
                  <select
                    className="w-full border p-2 rounded text-sm bg-gray-50 text-gray-700"
                    onChange={(e) => {
                      const d = e.target.value;
                      if (d && requests[d]) {
                        const r = requests[d];
                        if (r.type === "時間指定") {
                          setCustomStart(r.start); setCustomEnd(r.end);
                          setIsPaidLeaveSelected(false); setIsFreeSelected(false);
                        } else if (r.type === "有給") {
                          setIsPaidLeaveSelected(true); setIsFreeSelected(false);
                        } else if (r.type === "フリー") {
                          setIsFreeSelected(true); setIsPaidLeaveSelected(false);
                        } else {
                          setIsPaidLeaveSelected(false); setIsFreeSelected(false);
                        }
                        // リセット後に指定したタイプを即時保存する
                        saveRequest(r.type, r.start || "09:30", r.end || "15:00");
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>他の日の希望コピーする...</option>
                    {Object.keys(requests).sort((a, b) => Number(a) - Number(b)).map(d => {
                      if (d === String(selectedDay)) return null;
                      const r = requests[d];
                      return <option key={d} value={d}>{d}日 ({r.type}{r.type === "時間指定" ? ` ${r.start}-${r.end}` : ""})</option>
                    })}
                  </select>
                </div>
              )}

              <div className="flex gap-2 mt-6">
                <button onClick={removeRequest} className="flex-1 py-2 border border-gray-300 text-gray-500 rounded">クリア(削除)</button>
              </div>
            </div>
          </div>
        )}

        {/* 提出一覧モーダル (管理者修正用: リアルタイム反映 + 黄色検知) */}
        {previewRequestModalOpen && previewRequestData && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreviewRequestModalOpen(false)}>
            <div className="bg-white w-full max-w-md rounded-xl p-6 shadow-2xl overflow-y-auto max-h-[80vh]" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">{previewRequestData.name}さんの希望</h3>
                <span className="text-xs bg-gray-100 px-2 py-1 rounded">タップして修正</span>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs">
                {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => <div key={i} className="font-bold">{d}</div>)}
                {[...Array(new Date(year, month - 1, 1).getDay())].map((_, i) => <div key={`empty-${i}`} className="aspect-square"></div>)}
                {[...Array(daysInMonth)].map((_, i) => {
                  const d = i + 1;
                  // 現在編集中の editingRequests を参照
                  const req = editingRequests[d];

                  // 変更検知: オリジナルと比較
                  const originalReq = previewRequestData.requests[d];
                  const isChanged = JSON.stringify(req) !== JSON.stringify(originalReq);

                  let bgClass = "";
                  if (isChanged) bgClass = "bg-yellow-100 text-yellow-700 font-bold border-yellow-300";
                  else if (req) {
                    if (req.type === "希望休") bgClass = "bg-red-100 text-red-600 font-bold border-red-200";
                    else if (req.type === "有給") bgClass = "bg-pink-100 text-pink-600 font-bold border-pink-200";
                    else if (req.type === "フリー") bgClass = "bg-green-100 text-green-700 font-bold border-green-200";
                    else bgClass = "bg-blue-50 font-bold text-blue-700";
                  }

                  const disp = req ? getShiftDisplay(req.type, req.start, req.end) : "";
                  return (
                    <div key={d} className={`aspect-square border rounded flex items-center justify-center cursor-pointer hover:bg-gray-100 ${bgClass}`} onClick={() => startAdminEdit(d)}>
                      <div><div className="text-[10px] text-gray-400">{d}</div><div>{disp}</div></div>
                    </div>
                  )
                })}
              </div>
              <button onClick={handleSubmit} className="w-full mt-4 py-3 bg-blue-600 text-white font-bold rounded shadow-lg">変更を確定して保存</button>
              <button onClick={() => setPreviewRequestModalOpen(false)} className="w-full mt-2 py-2 text-gray-500 rounded text-xs">保存せずに閉じる</button>
            </div>
          </div>
        )}

        {skillModalOpen && editingStaff && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setSkillModalOpen(false)}>
            <div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4 text-center border-b pb-2">{editingStaff.name}さんのスキル</h3>
              <div className="space-y-3">
                {['fridge:冷蔵庫', 'washing:洗濯機', 'ac:エアコン', 'tv:TV', 'mobile:携帯', 'pc:PC'].map((item) => {
                  const [key, label] = item.split(':'); const currentVal = editingStaff.skills?.[key] || 0;
                  return (<div key={key} className="flex justify-between items-center"><span className="text-sm font-bold">{label}</span><div className="flex gap-1">{[1, 2, 3, 4, 5].map(num => (<button key={num} onClick={() => handleSkillClick(key, num)} className={`w-8 h-8 rounded border text-sm transition-colors ${currentVal === num ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>{num}</button>))}</div></div>);
                })}
              </div>
              <div className="flex gap-2 mt-6"><button onClick={() => setSkillModalOpen(false)} className="flex-1 py-2 border rounded">キャンセル</button><button onClick={saveSkills} className="flex-1 py-2 bg-blue-600 text-white rounded font-bold">保存</button></div>
            </div>
          </div>
        )}

        {skillDetailModalOpen && selectedSkillDetail && (
          <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => setSkillDetailModalOpen(false)}>
            <div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4 text-center border-b pb-2">{skillLabelMap[selectedSkillDetail.key]} 保有者一覧</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {selectedSkillDetail.list.length > 0 ? (
                  selectedSkillDetail.list.map((item, idx) => (
                    <div key={idx} className="flex justify-between border-b pb-1">
                      <span>{item.name}</span>
                      <span className="font-bold">{item.val}</span>
                    </div>
                  ))
                ) : <div className="text-center text-gray-400">該当者なし</div>}
              </div>
              <button onClick={() => setSkillDetailModalOpen(false)} className="w-full mt-4 py-2 bg-gray-200 rounded">閉じる</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}