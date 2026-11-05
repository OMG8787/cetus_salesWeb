/**
 * robot-loader.js
 * 放在官網上的「載入器」，只負責呼叫 GitHub 上的 robot-widget.js。
 * 這支檔案建立後幾乎不需要再改，日常更新只改 robot-widget.js 即可。
 */
(function () {
  'use strict';

  // ===== 只需設定一次 =====
  var CONFIG = {
    user: 'OMG8787',     // GitHub 帳號
    repo: 'cetus_salesWeb',         // 儲存庫名稱
    ref: 'main',                  // 分支名稱，或 tag（如 v1.0.0）、commit hash
    file: 'robot-widget.js',      // 檔案路徑
    cacheBust: false              // true：每次都附上時間戳記（測試時用，正式上線建議 false）
  };
  // ========================

  // 避免重複載入
  if (window.__robotLoaderLoaded) return;
  window.__robotLoaderLoaded = true;

  // 使用 jsDelivr：raw.githubusercontent.com 會以 text/plain 回應，瀏覽器不會執行
  var src =
    'https://cdn.jsdelivr.net/gh/' +
    CONFIG.user + '/' + CONFIG.repo + '@' + CONFIG.ref + '/' + CONFIG.file;

  if (CONFIG.cacheBust) {
    src += '?t=' + Date.now();
  }

  var script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.onerror = function () {
    console.warn('[robot-loader] 載入失敗：', src);
  };

  (document.head || document.documentElement).appendChild(script);
})();
