import { db } from "../lib/firebase"; // これを追加
"use client"
import { useState, useEffect } from "react";

export default function Home() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [year, setYear] = useState(0);
  const [month, setMonth] = useState(0);

  // ▼ 自動で「何月のシフトを扱うか」を決める
  useEffect(() => {
    const today = new Date();
    // 例: 15日を過ぎたら「来月」のシフトに切り替える
    if (today.getDate() >= 15) {
      today.setMonth(today.getMonth() + 1);
    }
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1); // 月は0始まりなので+1
  }, []);

  // ▼ 管理者ログイン処理
  const handleLogin = () => {
    if (password === "admin123") { // ※仮のパスワード
      setIsAdmin(true);
    } else {
      alert("パスワードが違います");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 font-sans text-gray-800">
      <div className="max-w-md mx-auto bg-white shadow-lg rounded-xl overflow-hidden">
        
        {/* ヘッダー部分 */}
        <div className="bg-blue-600 p-4 text-white text-center">
          <h1 className="text-xl font-bold">
            {year}年 {month}月 シフト{isAdmin ? "作成（管理者）" : "提出"}
          </h1>
        </div>

        <div className="p-6">
          {/* ▼ スタッフ用画面（通常時） */}
          {!isAdmin && (
            <div>
              <p className="mb-4 text-sm text-gray-600">
                希望するシフトを入力して提出してください。<br/>
                <span className="text-red-500 text-xs">※締切: 20日まで</span>
              </p>
              
              {/* カレンダーのモック（見た目だけ） */}
              <div className="grid grid-cols-7 gap-1 mb-4 text-center text-sm">
                {['日','月','火','水','木','金','土'].map(d => (
                  <div key={d} className="font-bold text-gray-400">{d}</div>
                ))}
                {/* 適当に30個マスを作るテスト */}
                {[...Array(30)].map((_, i) => (
                  <div key={i} className="border p-2 rounded hover:bg-blue-50 cursor-pointer">
                    {i + 1}
                  </div>
                ))}
              </div>

              <input 
                type="text" 
                placeholder="お名前" 
                className="w-full p-2 border rounded mb-4 bg-gray-50"
              />
              <button className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition">
                シフトを提出する
              </button>

              {/* 管理者への入り口 */}
              <div className="mt-8 pt-4 border-t text-right">
                <details className="text-xs text-gray-400">
                  <summary className="cursor-pointer list-none">管理者メニュー</summary>
                  <div className="mt-2 flex gap-2">
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

          {/* ▼ 管理者用画面（パスワード入力後） */}
          {isAdmin && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-bold text-lg">管理者ダッシュボード</h2>
                <button 
                  onClick={() => setIsAdmin(false)}
                  className="text-xs text-blue-600 underline"
                >
                  ログアウト
                </button>
              </div>

              <div className="space-y-3">
                <button className="w-full border-2 border-dashed border-gray-300 p-4 rounded text-gray-500 hover:border-blue-500 hover:text-blue-500">
                  Pythonでシフト自動作成を実行<br/>
                  <span className="text-xs">（まだ動きません）</span>
                </button>
                
                <div className="bg-gray-100 p-3 rounded">
                  <h3 className="text-sm font-bold mb-2">提出状況</h3>
                  <ul className="text-sm space-y-1">
                    <li className="flex justify-between"><span>田中</span> <span className="text-green-600">提出済</span></li>
                    <li className="flex justify-between"><span>鈴木</span> <span className="text-red-400">未提出</span></li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}