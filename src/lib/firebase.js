import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC_gAW0sQZ4deYTN34JAAz5vlFJa3m2tlc",
  authDomain: "himonnya-customer-tool.firebaseapp.com",
  projectId: "himonnya-customer-tool",
  storageBucket: "himonnya-customer-tool.firebasestorage.app",
  messagingSenderId: "132254546054",
  appId: "1:132254546054:web:5a3c8be43bc87cbfc4b907",
  measurementId: "G-2PE1QN9394"
};

// アプリの二重起動を防ぐおまじない
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

// ▼▼▼ これが一番大事な行です！ ▼▼▼
export { db };