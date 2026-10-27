/* Shared "Back to Library" control for any game page. Add to a game's index.html:
 *     <script src="../../assets/back-to-library.js"></script>
 * It adds a small fixed button (top-left) that returns to the launcher using a RELATIVE path, so it works from
 * file:// and from any hosting domain. If the game has unsaved progress it can ask first:
 *     window.ArcadeLibrary = { needsConfirm: () => game.isInRun(), message: 'Leave this run? Progress will be lost.' };
 * (define that before or after loading this script; it is read when the button is clicked). */
(function () {
  'use strict';
  const HOME = '../../index.html';
  const css = '.arcade-back{position:fixed;left:10px;top:10px;z-index:2147483000;font:600 13px/1 system-ui,sans-serif;letter-spacing:.04em;color:#ece8df;background:rgba(10,11,14,.78);border:1px solid rgba(255,255,255,.22);padding:9px 14px;border-radius:999px;text-decoration:none;backdrop-filter:blur(6px);cursor:pointer}.arcade-back:hover,.arcade-back:focus-visible{border-color:#f2a53a;outline:none}';
  function add() {
    if (document.querySelector('.arcade-back')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.append(st);
    const a = document.createElement('a'); a.className = 'arcade-back'; a.href = HOME; a.textContent = '← Library'; a.setAttribute('aria-label', 'Back to Library');
    a.addEventListener('click', e => {
      const L = window.ArcadeLibrary;
      if (L && typeof L.needsConfirm === 'function' && L.needsConfirm() && !window.confirm(L.message || 'Leave this game? Unsaved progress will be lost.')) e.preventDefault();
    });
    document.body.append(a);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
