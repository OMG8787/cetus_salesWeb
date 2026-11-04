// =========================================================
// 深色 / 淺色模式（整個系統共用）
//   第一次進來跟著瀏覽器 / 系統的設定，按右上角的 🌙 / ☀️ 切換後記住（只存在這個瀏覽器）
//   放在 <head> 最前面載入，頁面畫出來之前就套用，不會閃一下白畫面
//   用 <html data-theme="dark|light"> 切換；深色的顏色在 dark.css
// =========================================================
(function () {
  'use strict';

  var KEY = 'aoi_theme';
  var root = document.documentElement;

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : '';
    } catch (e) {
      return '';
    }
  }

  function system() {
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply(t) {
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t;
    document.querySelectorAll('[data-theme-btn]').forEach(function (b) {
      b.textContent = t === 'dark' ? '☀️' : '🌙';
      b.title = t === 'dark' ? '切換為淺色（日間）模式' : '切換為深色（夜間）模式';
      b.setAttribute('aria-label', b.title);
    });
  }

  apply(saved() || system());

  window.Theme = {
    get: function () {
      return root.getAttribute('data-theme') || 'light';
    },
    set: function (t) {
      if (t !== 'dark' && t !== 'light') return;
      try {
        localStorage.setItem(KEY, t);
      } catch (e) {}
      apply(t);
      try {
        window.dispatchEvent(new CustomEvent('themechange', { detail: t }));
      } catch (e) {}
    },
    toggle: function () {
      this.set(this.get() === 'dark' ? 'light' : 'dark');
    },
  };

  // 沒有手動選過 → 系統切換深淺色時跟著變
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var follow = function () {
      if (!saved()) apply(system());
    };
    if (mq.addEventListener) mq.addEventListener('change', follow);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-btn]');
    if (b) window.Theme.toggle();
  });

  // 切換按鈕：頁首右側（登出按鈕前面）；登入頁沒有頁首，放在右上角
  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('[data-theme-btn]')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-theme-btn', '');
      var header = document.querySelector('header > div:last-child');
      if (header) {
        btn.className = 'theme-btn';
        header.insertBefore(btn, header.querySelector('button'));
      } else {
        btn.className = 'theme-btn theme-btn-float';
        document.body.appendChild(btn);
      }
    }
    apply(window.Theme.get());
  });
})();
