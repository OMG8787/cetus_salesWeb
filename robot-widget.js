/**
 * robot-widget.js —— 「固定的跳板」，之後幾乎不用再改。
 * 官網載入的 robot-loader.js 會抓這支；這支再去抓真正的程式 robot-app.js，並在網址後面加一個「每小時換一次」的版本參數。
 * 這樣 robot-app.js 每次改版，訪客最慢約 1 小時內就會拿到新的，不會被瀏覽器的 7 天快取卡住（jsDelivr 預設讓瀏覽器快取 7 天）。
 * 要改機器人的外觀 / 行為請改 robot-app.js；改這支只有在想調整更新頻率時才需要。
 */
(function () {
  'use strict';
  if (window.__robotAppLoading) return;
  window.__robotAppLoading = true;

  var MINUTES = 60; // 瀏覽器最多多久重新抓一次 robot-app.js
  var FALLBACK = 'https://cdn.jsdelivr.net/gh/OMG8787/cetus_salesWeb@main/robot-app.js';

  var base = FALLBACK;
  try {
    var cur = document.currentScript && document.currentScript.src;
    if (cur && /robot-widget\.js/.test(cur)) base = cur.split('?')[0].replace(/robot-widget\.js$/, 'robot-app.js'); // 跟著 loader 用的帳號 / 分支 / 版本走
  } catch (e) { /* 用預設網址 */ }

  var s = document.createElement('script');
  s.src = base + '?v=' + Math.floor(Date.now() / (MINUTES * 60000));
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.onerror = function () { console.warn('[robot-widget] 載入失敗：', s.src); };
  (document.head || document.documentElement).appendChild(s);
})();
