/* Arcade launcher. Plain JS, no network: the game list comes from registry.js (generated from games.json), so it
 * works from file:// as well as from static hosting. Local state lives under one key, "arcade.v1":
 *   { v:1, prefs:{ motion:'system'|'on'|'off', uiSounds:bool, startMuted:bool }, activity:{ [id]:{ plays, last } } }
 * Games may read "arcade.v1" (read-only) to honour the shared preferences. */
(function () {
  'use strict';
  const GAMES = (window.ARCADE_GAMES || []).filter(g => g && g.id && g.entry);
  const KEY = 'arcade.v1';
  const IS_FILE = location.protocol === 'file:';
  const $main = document.getElementById('main');

  /* ---------- safe storage ---------- */
  let memory = {};   // used when localStorage is blocked, so the page still works for this visit
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v === null ? (k in memory ? memory[k] : null) : v; } catch (e) { return k in memory ? memory[k] : null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { memory[k] = v; return false; } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } delete memory[k]; },
    keys() { try { const out = []; for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); return out; } catch (e) { return Object.keys(memory); } },
  };

  /* ---------- state ---------- */
  const DEFAULT_PREFS = { motion: 'system', uiSounds: true, startMuted: false };
  function load() {
    let s = null;
    try { s = JSON.parse(store.get(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || s.v !== 1) s = { v: 1, prefs: {}, activity: {} };   // (future versions: migrate here)
    s.prefs = Object.assign({}, DEFAULT_PREFS, s.prefs && typeof s.prefs === 'object' ? s.prefs : {});
    if (!s.activity || typeof s.activity !== 'object') s.activity = {};
    return s;
  }
  let state = load();
  const save = () => store.set(KEY, JSON.stringify(state));
  const gameById = id => GAMES.find(g => g.id === id);

  function recordLaunch(id) {
    const a = state.activity[id] || { plays: 0, last: 0 };
    a.plays++; a.last = Date.now(); state.activity[id] = a; save();
  }

  /* ---------- helpers ---------- */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k];
      if (v === false || v == null) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  function ago(t) {
    if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
    return new Date(t).toLocaleDateString();
  }
  const bytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
  function toast(text) {
    const t = document.getElementById('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function ask(title, text, okLabel) {
    const d = document.getElementById('dlg');
    if (!d.showModal) return Promise.resolve(window.confirm(title + '\n\n' + text));
    document.getElementById('dlg-title').textContent = title; document.getElementById('dlg-text').textContent = text;
    document.getElementById('dlg-ok').textContent = okLabel || 'OK';
    return new Promise(res => { d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }); d.returnValue = 'cancel'; d.showModal(); });
  }

  /* ---------- UI sounds (launcher only; honours the Sounds setting) ---------- */
  let actx = null;
  function blip(freq, len) {
    if (!state.prefs.uiSounds) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + len);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + len + 0.02);
    } catch (e) { /* audio unavailable */ }
  }

  /* ---------- appearance ---------- */
  function applyPrefs() {
    const r = document.documentElement.classList, m = state.prefs.motion;
    r.toggle('reduce-motion', m === 'on'); r.toggle('motion-on', m === 'off');   // 'off' = animate even if the OS asks for less
  }

  /* ---------- views ---------- */
  function launchLink(g, cls, label) {
    return h('a', { class: cls, href: g.entry, 'data-launch': g.id, 'aria-label': (label || 'Play') + ' ' + g.title, onclick: () => { recordLaunch(g.id); blip(520, 0.12); } },
      h('span', { class: 'play-ico', 'aria-hidden': 'true' }), label || 'Play');
  }
  const chip = t => h('span', { class: 'chip', text: t });
  const withAccent = (g, node) => { node.style.setProperty('--accent', g.accent || '#f2a53a'); return node; };
  const lastText = g => { const a = state.activity[g.id]; return a && a.last ? 'Played ' + ago(a.last) : 'Not played yet'; };

  function viewHome() {
    const feat = GAMES.find(g => g.featured) || GAMES[0];
    const frag = h('div', { class: 'view' });
    if (feat) {
      const hero = withAccent(feat, h('section', { class: 'hero', 'aria-label': 'Featured game' },
        h('img', { src: feat.cover, alt: '' }),
        h('div', { class: 'hero-in' },
          h('div', { class: 'kicker', text: 'Featured · ' + feat.genre }),
          h('h1', { text: feat.title }),
          h('p', { class: 'tag', text: feat.tagline }),
          h('p', { class: 'desc', text: feat.description }),
          h('div', { class: 'chips' }, chip(feat.players || '1 player'), feat.offline && chip('Works offline'), (feat.tags || []).slice(0, 3).map(chip)),
          h('div', { class: 'hero-actions' }, launchLink(feat, 'btn solid'), h('a', { class: 'btn', href: '#/game/' + feat.id }, 'Details')))));
      frag.append(hero);
    }
    const recent = Object.entries(state.activity).filter(([id, a]) => gameById(id) && a.last).sort((a, b) => b[1].last - a[1].last).slice(0, 4);
    const rec = h('section', { class: 'block', 'aria-label': 'Recently played' }, h('h2', { text: 'Recently played' }));
    if (recent.length) {
      rec.append(h('div', { class: 'recent' }, recent.map(([id, a]) => { const g = gameById(id);
        return withAccent(g, h('a', { class: 'rcard', href: g.entry, onclick: () => { recordLaunch(g.id); blip(520, .12); } }, h('img', { src: g.cover, alt: '' }), h('div', {}, h('b', { text: g.title }), h('small', { text: 'Played ' + ago(a.last) + ' · ' + a.plays + (a.plays === 1 ? ' launch' : ' launches') })))); })));
    } else rec.append(h('p', { class: 'empty', text: 'Nothing yet. Launch a game below and it will show up here.' }));
    frag.append(rec);
    const lib = h('section', { class: 'block', id: 'library', 'aria-label': 'Game library' }, h('h2', { text: 'Library · ' + GAMES.length + ' games' }));
    lib.append(h('div', { class: 'grid' }, GAMES.map(g => withAccent(g, h('article', { class: 'card' },
      h('a', { class: 'art', href: '#/game/' + g.id, 'aria-label': g.title + ' details' }, h('img', { src: g.cover, alt: '', loading: 'lazy' }), h('span', { class: 'chip genre', text: g.genre })),
      h('div', { class: 'body' },
        h('h3', {}, h('a', { href: '#/game/' + g.id, text: g.title })),
        h('p', { text: g.description }),
        h('div', { class: 'row' }, h('span', { class: 'last', text: lastText(g) }), launchLink(g, 'btn solid small'))))))));
    frag.append(lib);
    return frag;
  }

  function viewDetail(id) {
    const g = gameById(id);
    if (!g) return h('div', { class: 'view settings' }, h('h1', { text: 'Game not found' }), h('p', { class: 'sub' }, 'There is no game called "' + id + '". '), h('a', { class: 'btn', href: '#/' }, 'Back to Library'));
    const a = state.activity[g.id];
    return withAccent(g, h('div', { class: 'view detail' },
      h('a', { class: 'back', href: '#/' }, '← Back to Library'),
      h('div', {},
        h('div', { class: 'cover' }, h('img', { src: g.cover, alt: g.title + ' artwork' })),
        h('div', { class: 'panel' }, h('h4', { text: 'Game modes' }), h('div', { class: 'modes' }, (g.modes || []).map(m => h('div', { class: 'mode' }, h('b', { text: m.name }), h('span', { text: m.text }))))),
        h('div', { class: 'panel' }, h('h4', { text: 'Features' }), h('ul', { class: 'list' }, (g.features || []).map(f => h('li', { text: f }))))),
      h('div', {},
        h('div', { class: 'kicker', text: g.genre }),
        h('h1', { text: g.title }),
        h('p', { class: 'lead', text: g.description }),
        h('div', { class: 'hero-actions' }, launchLink(g, 'btn solid')),
        h('div', { class: 'panel' }, h('h4', { text: 'Controls' }), h('div', { class: 'keys' }, (g.controls || []).map(c => [h('kbd', { text: c.keys }), h('span', { text: c.action })]))),
        h('div', { class: 'panel' }, h('h4', { text: 'Info' }), h('div', { class: 'facts' },
          fact('Players', g.players || '1 player'), fact('Offline', g.offline ? 'Yes' : 'Needs internet'), fact('Version', g.version || '1.0'),
          fact('Last played', a && a.last ? ago(a.last) : 'Never'), fact('Launches', String(a ? a.plays : 0)))),
        h('p', { class: 'note', text: 'Saves: ' + (g.storage && g.storage.note ? g.storage.note : 'stored in this browser') }))));
  }
  const fact = (k, v) => h('div', { class: 'fact' }, h('small', { text: k }), h('b', { text: v }));

  /* ---- save data: export / import ---- */
  const allowedPrefixes = () => ['arcade.'].concat(...GAMES.map(g => (g.storage && g.storage.prefixes) || []));
  const allowedKey = k => allowedPrefixes().some(p => k.startsWith(p));
  function exportData() {
    const entries = {};
    store.keys().filter(allowedKey).forEach(k => { entries[k] = store.get(k); });
    const blob = new Blob([JSON.stringify({ format: 'arcade-save', version: 1, exportedAt: new Date().toISOString(), entries }, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'arcade-save-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Exported ' + Object.keys(entries).length + ' items.');
  }
  async function importData(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { toast('That file is not valid JSON.'); return; }
    if (!obj || obj.format !== 'arcade-save' || obj.version !== 1 || !obj.entries || typeof obj.entries !== 'object') { toast('That is not an Arcade save file.'); return; }
    const keys = Object.keys(obj.entries).filter(k => allowedKey(k) && typeof obj.entries[k] === 'string');
    if (!keys.length) { toast('The file has no data for these games.'); return; }
    const existing = keys.filter(k => store.get(k) !== null).length;
    const ok = await ask('Import saves?', keys.length + ' items will be imported.' + (existing ? '\n' + existing + ' of them will REPLACE what is stored here now.' : '') + '\nThis cannot be undone (export first if unsure).', 'Import');
    if (!ok) return;
    keys.forEach(k => store.set(k, obj.entries[k]));
    state = load(); applyPrefs(); toast('Imported ' + keys.length + ' items.'); route();
  }

  function viewSettings() {
    const p = state.prefs;
    const sw = (key, on) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: on, onchange: e => { p[key] = e.target.checked; save(); blip(660, .08); } }), h('i'));
    const sel = h('select', { 'aria-label': 'Reduce motion', onchange: e => { p.motion = e.target.value; save(); applyPrefs(); } },
      ['system:Follow system', 'on:Reduce motion', 'off:Always animate'].map(o => { const [v, t] = o.split(':'); return h('option', { value: v, selected: p.motion === v, text: t }); }));
    const per = GAMES.map(g => { let n = 0, c = 0; store.keys().forEach(k => { if ((g.storage.prefixes || []).some(x => k.startsWith(x))) { n += (k.length + (store.get(k) || '').length) * 2; c++; } }); return [g, n, c]; });
    const mine = store.keys().filter(k => k.startsWith('arcade.')).reduce((n, k) => n + (k.length + (store.get(k) || '').length) * 2, 0);
    const est = h('tr', { hidden: true }, h('td', { text: 'Browser quota (this site)' }), h('td', { text: '' }));
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { if (e && e.quota) { est.hidden = false; est.lastChild.textContent = bytes(e.usage || 0) + ' of ' + bytes(e.quota); } }).catch(() => {});
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; } });
    const supports = key => GAMES.filter(g => (g.capabilities || []).includes(key)).map(g => g.title).join(', ') || 'no game yet';
    return h('div', { class: 'view settings' },
      h('h1', { text: 'Settings' }), h('p', { class: 'sub', text: 'Stored on this device only.' }),
      h('div', { class: 'panel' }, h('h4', { text: 'Preferences' }),
        h('div', { class: 'setrow' }, h('div', {}, h('b', { text: 'Motion' }), h('small', { text: 'Turns off launcher animations. Touge Drift also tones down camera shake and effects.' })), sel),
        h('div', { class: 'setrow' }, h('div', {}, h('b', { text: 'Launcher sounds' }), h('small', { text: 'A soft click when you launch a game or flip a switch.' })), sw('uiSounds', p.uiSounds)),
        h('div', { class: 'setrow' }, h('div', {}, h('b', { text: 'Start games muted' }), h('small', { text: 'Supported by: ' + supports('startMuted') + '.' })), sw('startMuted', p.startMuted)),
        h('div', { class: 'btnrow', style: 'margin-top:10px' }, h('button', { class: 'btn small danger', onclick: async () => { if (await ask('Reset preferences?', 'Motion, sound and mute options go back to their defaults. Play history and game saves are not touched.', 'Reset')) { state.prefs = Object.assign({}, DEFAULT_PREFS); save(); applyPrefs(); toast('Preferences reset.'); route(); } } }, 'Reset preferences'),
          h('button', { class: 'btn small', onclick: async () => { if (await ask('Clear play history?', 'Recently played and launch counts are removed. Game saves are not touched.', 'Clear')) { state.activity = {}; save(); toast('Play history cleared.'); route(); } } }, 'Clear play history'))),
      h('div', { class: 'panel' }, h('h4', { text: 'Save data' }),
        h('p', { class: 'note', style: 'margin:0 0 12px', text: 'Export everything (launcher and every game) to one file, or restore from one. Use this to move progress between browsers or devices.' }),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn small', onclick: exportData }, 'Export all data'), h('button', { class: 'btn small', onclick: () => fileIn.click() }, 'Import data…'), fileIn)),
      h('div', { class: 'panel' }, h('h4', { text: 'Storage' }),
        h('table', { class: 'store' }, h('tbody', {}, h('tr', {}, h('td', { text: 'Launcher' }), h('td', { text: bytes(mine) })),
          per.map(([g, n, c]) => h('tr', {}, h('td', { text: g.title }), h('td', { text: c ? bytes(n) + ' · ' + c + (c === 1 ? ' item' : ' items') : 'no saves yet' }))), est)),
        h('p', { class: 'note', text: IS_FILE ? 'You opened this from a file. Browsers differ on whether saves are kept (or shared between folders) for file:// pages, so treat them as temporary and export now and then. Hosted over http(s) they persist normally.' : 'Saves live in this browser\'s local storage for this site. Clearing site data erases them, so export now and then.' })));
  }

  /* ---------- router ---------- */
  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
    let node, nav = 'home';
    if (parts[0] === 'game') { node = viewDetail(decodeURIComponent(parts[1] || '')); const g = gameById(parts[1]); document.title = (g ? g.title + ' · ' : '') + 'Arcade'; }
    else if (parts[0] === 'settings') { node = viewSettings(); nav = 'settings'; document.title = 'Settings · Arcade'; }
    else { node = viewHome(); document.title = 'Arcade'; }
    $main.replaceChildren(node);
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
    if (route.n++) { window.scrollTo(0, 0); $main.focus({ preventScroll: true }); }
  }
  route.n = 0;

  window.addEventListener('hashchange', route);
  window.addEventListener('pageshow', e => { if (e.persisted) { state = load(); route(); } });   // back from a game via the browser cache
  window.addEventListener('storage', e => { if (e.key === KEY) { state = load(); applyPrefs(); route(); } });
  document.getElementById('foot-mode').textContent = IS_FILE ? 'Running from local files' : 'Hosted';
  applyPrefs(); route();

  // Offline cache: only where service workers exist (http/https), never from file://
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ });
  }
  window.__arcade = { GAMES, load, KEY, route };
})();
