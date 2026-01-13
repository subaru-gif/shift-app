import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// 新しいプロジェクト(shift-mane)の設定
const firebaseConfig = {
  apiKey: "AIzaSyD4Yn7aJrUkiSnZwqXQ-nXqAV6XXmvzIAs",
  authDomain: "shift-mane.firebaseapp.com",
  projectId: "shift-mane",
  storageBucket: "shift-mane.firebasestorage.app",
  messagingSenderId: "579606969372",
  appId: "1:579606969372:web:f6688a96df21029de2b3d9",
  measurementId: "G-SXRBT0F4KJ"
};

// アプリの二重起動を防ぐおまじない
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// データベースを使う準備
const db = getFirestore(app);

// これを忘れずに！
export { db };