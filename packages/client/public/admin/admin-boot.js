/**
 * admin-boot.js — 系統管理員後台「進場遮罩」
 *
 * 載入時機:每個 admin/*.html <head> 第一個 <script>(同步阻塞)
 * 任務:
 *   1. 在 body 渲染前先讓 body 隱藏,避免協作者看到後台內容才跳 login
 *   2. DOM ready 後在最頂層注入 splash overlay(觸手紋章 + Unknowable Game)
 *   3. 提供 window.__adminSplashReveal() 給 admin-shared.js 在 auth 通過時調用
 *
 * 「知道真相的人看事物的本質」 — 這是 UX 層遮罩,
 *  disable JS 的訪客仍可看到 HTML 骨架。徹底擋要動 server。
 */
(function () {
  if (window.__adminBootInited) return;
  window.__adminBootInited = true;

  var STYLE_ID = '__admin-splash-style';
  var OVERLAY_ID = '__admin-splash-overlay';
  var MIN_SPLASH_MS = 800;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      'html { background: #0c0a08 !important; }',
      'body:not(.__admin-revealed) { visibility: hidden !important; }',
      '#' + OVERLAY_ID + ' {',
      '  position: fixed; inset: 0; z-index: 2147483647;',
      '  display: flex; flex-direction: column; align-items: center; justify-content: center;',
      '  background: #0c0a08; color: #d9d2c5;',
      '  font-family: "Noto Serif TC", serif; gap: 28px;',
      '  animation: __adminSplashFadeIn 0.6s linear both;',
      '  visibility: visible !important;',
      '}',
      '#' + OVERLAY_ID + '.fading-out { opacity: 0; transition: opacity 0.5s linear; }',
      '#' + OVERLAY_ID + ' .__splash-title {',
      '  font-size: 48px; font-weight: 700; letter-spacing: 0.05em;',
      '  color: #d9d2c5; margin: 0;',
      '  text-shadow: 0 0 18px rgba(217,210,197,0.12);',
      '}',
      '#' + OVERLAY_ID + ' .__splash-emblem { filter: drop-shadow(0 0 24px rgba(242, 196, 21, 0.35)); }',
      '@keyframes __adminSplashFadeIn { from { opacity: 0 } to { opacity: 1 } }',
      '@keyframes __adminSplashBreathe { 0%,100% { opacity: 0.4 } 50% { opacity: 0.9 } }',
      '#' + OVERLAY_ID + ' .__splash-pulse { animation: __adminSplashBreathe 1.5s ease-in-out infinite; }',
      '@media (max-width: 768px) {',
      '  #' + OVERLAY_ID + ' .__splash-title { font-size: 32px; }',
      '  #' + OVERLAY_ID + ' svg { width: 130px; height: 130px; }',
      '}',
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  // Yellow Sign — Robert W. Chambers《The King in Yellow》的經典符號
  // 三條螺旋觸手 120° 對稱 + 中心同心圓 + 呼吸光點
  var YELLOW = '#F2C415';
  var TENTACLE_PATH =
    'M 100 86 Q 100 55, 73 50 Q 45 52, 48 80 Q 53 96, 75 90 Q 84 86, 88 80';

  function buildYellowSign() {
    return [
      '<g fill="none" stroke="' + YELLOW + '" stroke-width="7" ',
      'stroke-linecap="round" stroke-linejoin="round">',
      '<path d="' + TENTACLE_PATH + '"/>',
      '<g transform="rotate(120 100 100)"><path d="' + TENTACLE_PATH + '"/></g>',
      '<g transform="rotate(240 100 100)"><path d="' + TENTACLE_PATH + '"/></g>',
      '</g>',
      '<circle cx="100" cy="100" r="14" fill="none" stroke="' + YELLOW + '" stroke-width="3"/>',
      '<circle cx="100" cy="100" r="5" fill="' + YELLOW + '" class="__splash-pulse"/>',
    ].join('');
  }

  function injectOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    if (!document.body) return;
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = [
      '<div class="__splash-emblem">',
      '<svg viewBox="0 0 200 200" width="180" height="180" aria-label="The Yellow Sign">',
      buildYellowSign(),
      '</svg>',
      '</div>',
      '<h1 class="__splash-title">Unknowable Game</h1>',
    ].join('');
    document.body.appendChild(overlay);
  }

  injectStyle();
  if (document.body) {
    injectOverlay();
  } else {
    document.addEventListener('DOMContentLoaded', injectOverlay);
  }

  var startTime = Date.now();

  window.__adminSplashReveal = function () {
    var elapsed = Date.now() - startTime;
    var remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
    setTimeout(function () {
      if (document.body) document.body.classList.add('__admin-revealed');
      var overlay = document.getElementById(OVERLAY_ID);
      if (!overlay) return;
      overlay.classList.add('fading-out');
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 500);
    }, remaining);
  };

  // auth 失敗時呼叫:不 reveal,等 redirect 自然發生
  window.__adminSplashKeep = function () {};
})();
