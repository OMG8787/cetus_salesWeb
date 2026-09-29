// Apps Script 部署後的 Web App 網址
const API_URL = "https://script.google.com/macros/s/AKfycbzcPiEcfv_mHLmK7qyqlYPF9LS8SWZIstcyNDnQdz1pz1a7O2sUTwF74LDIYXOd59wr1A/exec";

// true = 示範模式：不連後端，用本機假資料 + 固定帳密 0000/0000 測試畫面
// false = 正式模式：真的連上面的 Apps Script / Google 試算表
const DEMO_MODE = false;

// 選型計算頁的相機型錄：公開 Google 試算表 ID（需有 GigE / USB3 兩個分頁，跟 CCD_camera.html 用同一份）
// 留空 '' 就不讀型錄，改用手動輸入相機規格
const CAMERA_CATALOG_SHEET_ID = '1Enn6Yr6bOtlpWUSoy_Hd00VKWQh-0m4x';
