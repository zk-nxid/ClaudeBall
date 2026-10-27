/* Touge Drift - game controller: input, fixed-timestep loop, camera, effects, HUD data, run lifecycle. UI screens are in ui.js. */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const P = TD.Physics, V = TD.Vehicles, Race = TD.Race, Progress = TD.Progress, Save = TD.Save, Audio = TD.Audio;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const ASSIST = [0, 0.3, 0.55, 0.85], ASSIST_NAMES = ['Off', 'Low', 'Medium', 'High'], CAMERAS = ['Follow', 'Chase', 'Wide'];

  /* ---------- launcher preferences (read-only; shared key written by the launcher) ---------- */
  function launcherPrefs() { try { const s = JSON.parse(TD.Store.get('arcade.v1') || 'null'); return s && s.prefs ? s.prefs : {}; } catch (e) { return {}; } }

  const app = {
    save: null, settings: null, screen: 'title', race: null, track: null, run: null, paused: false, acc: 0, last: 0, now: 0,
    cam: { x: 0, y: 0, rot: 0, zoom: 1, anchor: 0.58, shake: 0 }, fx: null, keys: {}, pad: null, hud: { banner: null, hint: null, bankMsg: null, lostMsg: null, count: null },
    demo: null, reducedMotion: false, audioStarted: false, message: null, ghostStored: false, results: null, leaving: false,
  };

  const els = { canvas: null };
  let R = null, UI = null, trackShown = null;

  /* ---------- settings ---------- */
  function applySettings() {
    Audio.setVolume(app.settings.volume); Audio.setMuted(app.settings.muted || app.startMuted);
    Save.storeSettings(app.settings);
  }
  function setMuted(m) { app.settings.muted = !!m; app.startMuted = false; applySettings(); }

  /* ---------- track / demo ---------- */
  function showTrack(id) { const tr = Progress.track(id); if (trackShown !== id) { R.setTrack(tr); trackShown = id; app.fx.clear(); } app.track = tr; return tr; }

  function startDemo(courseId) {
    const track = showTrack(courseId || 'pine-ridge'), owned = Object.keys(app.save.owned);
    const sel = app.save.selected, rivals = [{ carId: 'tsurugi-rs4', skill: 0.8, name: 'Aoi', color: '#1c6fd1' }, { carId: 'orochi-tgt', skill: 0.74, name: 'Ren', color: '#c4231c' }];
    const r = Race.create({ track, mode: 'rival', player: { carId: sel, build: app.save.owned[sel], name: 'You', color: V.paintOf(app.save.owned[sel]) }, rivals, assist: 0 });
    r.player.human = false; r.player.driver = TD.AI.createDriver(track, r.player.c.p, 0.82, 3); r.state = 'running'; r.clock = 0; r.t = 0;
    app.demo = r; app.fx.clear(); trackShown = courseId || 'pine-ridge';
  }

  /* ---------- starting / ending a run ---------- */
  /** run: { mode, courseId, eventId, rivals:[...], ghost: bool } */
  function startRun(run) {
    Audio.ensure(); Audio.resume();
    const track = showTrack(run.courseId), sel = app.save.selected, build = app.save.owned[sel];
    app.run = run; app.ghostStored = false; app.results = null;
    const ghost = run.ghost !== false && run.mode !== 'drift' ? Save.loadGhost(run.courseId) : null;
    app.race = Race.create({ track, mode: run.mode, player: { carId: sel, build, name: 'You', color: V.paintOf(build) }, rivals: run.rivals || [], assist: ASSIST[app.settings.assist], ghost });
    app.fx.clear(); app.paused = false; app.acc = 0; app.demo = null; app.keys = {};
    app.hud = { banner: null, hint: { text: 'W/S  throttle · brake      A/D  steer      SPACE  handbrake      SHIFT  clutch kick      R  reset      C  camera', t: 9 }, bankMsg: null, lostMsg: null, count: null };
    const p = app.race.player; initCamera(p.c);
    app.screen = 'race'; UI.show(null);
  }
  function restartRun() { if (app.run) startRun(app.run); }
  function leaveRun(toScreen) {
    app.race = null; app.run = null; app.paused = false; app.results = null; Audio.silent();
    startDemo(app.track ? app.track.id : 'pine-ridge'); UI.show(toScreen || 'title');
  }

  function finishRun() {
    const r = app.race, run = app.run, res = Race.results(r);
    const before = JSON.stringify(app.save.records[run.courseId] || null);
    const out = Progress.applyResult(app.save, { mode: run.mode, courseId: run.courseId, eventId: run.eventId || null, carId: app.save.selected }, res);
    if (res.finished && out.newRecord.includes('time')) { const rec = app.save.records[run.courseId]; if (rec && rec.time) rec.time.splits = res.splits; }
    if (res.finished && res.ghost && (run.mode === 'time' || run.mode === 'rival')) {
      const old = Save.loadGhost(run.courseId);
      if (!old || res.time < old.time) { const slim = res.ghost.data; if (slim.length < 24000) Save.storeGhost(run.courseId, { carId: res.ghost.carId, time: res.time, dt: res.ghost.dt, data: slim }); }
    }
    Save.store(app.save);
    app.results = { res, out, run, target: targetsFor(run) };
    Audio.silent(); Audio.play.finish(out.medal); if (out.unlocks.length) setTimeout(() => Audio.play.complete(), 900);
    app.screen = 'results'; UI.show('results', app.results);
  }
  function targetsFor(run) {
    if (run.mode === 'time') return { kind: 'time', t: Progress.thresholds(run.courseId, 'time') };
    if (run.mode === 'drift') return { kind: 'drift', t: Progress.thresholds(run.courseId, 'drift') };
    return { kind: 'rival' };
  }

  /* ---------- input ---------- */
  const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', ' ']);
  function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function onKeyDown(e) {
    if (app.screen === 'race' && PREVENT.has(e.code) || PREVENT.has(e.key) && app.screen === 'race') { if (!typing(e)) e.preventDefault(); }
    if (typing(e)) return;
    if (!app.audioStarted) { app.audioStarted = true; Audio.ensure(); }
    const k = e.code; app.keys[k] = true;
    if (app.screen === 'race') {
      if (k === 'Escape' || k === 'KeyP') { e.preventDefault(); togglePause(); }
      else if (!app.paused) {
        if (k === 'KeyR') { if (Race.reset(app.race)) { Audio.play.reset(); app.hud.banner = { text: 'RESET  +' + Race.RESET_PENALTY + 's', t: 1.6, color: '#ff7a5a' }; app.fx.clear(); } }
        else if (k === 'KeyC') { app.settings.camera = (app.settings.camera + 1) % 3; applySettings(); app.hud.banner = { text: 'CAMERA: ' + CAMERAS[app.settings.camera].toUpperCase(), t: 1.2, color: '#d9d4c4' }; }
        else if (k === 'KeyM') setMuted(!app.settings.muted);
        else if (k === 'Equal' || k === 'NumpadAdd') { app.settings.zoom = clamp(app.settings.zoom * 1.1, 0.6, 1.8); applySettings(); }
        else if (k === 'Minus' || k === 'NumpadSubtract') { app.settings.zoom = clamp(app.settings.zoom / 1.1, 0.6, 1.8); applySettings(); }
      } else if (k === 'Escape') { /* handled above */ }
    } else if (UI && UI.key) UI.key(e);
  }
  function onKeyUp(e) { app.keys[e.code] = false; }
  function readInput() {
    if (api.inputOverride) return api.inputOverride(app.race);                       // test hook (automation drives the real loop with this)
    const k = app.keys; let thr = (k.KeyW || k.ArrowUp) ? 1 : 0, brk = (k.KeyS || k.ArrowDown) ? 1 : 0, st = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0), hb = !!k.Space, kick = !!(k.ShiftLeft || k.ShiftRight);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of pads) if (g && g.connected) {
      const ax = Math.abs(g.axes[0]) > 0.12 ? g.axes[0] : 0; if (ax) st = ax;
      const rt = g.buttons[7] ? g.buttons[7].value : 0, lt = g.buttons[6] ? g.buttons[6].value : 0; if (rt > 0.05) thr = Math.max(thr, rt); if (lt > 0.05) brk = Math.max(brk, lt);
      if (g.buttons[0] && g.buttons[0].pressed) hb = true; if (g.buttons[2] && g.buttons[2].pressed) kick = true;
    }
    return { throttle: thr, brake: brk, steer: st, handbrake: hb, kick };
  }
  function togglePause() {
    if (!app.race || app.race.state === 'finished' || app.results) return;
    if (!app.paused && app.screen !== 'race') return;                        // (a menu other than the pause menu is open)
    app.paused = !app.paused; if (app.paused) { Audio.silent(); UI.show('pause'); } else UI.show(null);
  }

  /* ---------- camera ---------- */
  function initCamera(c) { const cam = app.cam; cam.x = c.x; cam.y = c.y; cam.rot = camTargetRot(c); cam.zoom = 1; cam.shake = 0; }
  const camTargetRot = c => app.settings.camera === 1 ? -Math.PI / 2 - c.th : 0;
  function updateCamera(c, dt) {
    const cam = app.cam, mode = app.settings.camera, w = Math.cos(c.th), s = Math.sin(c.th);
    const Vx = c.vx * w - c.vy * s, Vy = c.vx * s + c.vy * w;
    const look = mode === 2 ? 0.35 : 0.62, tx = c.x + Vx * look, ty = c.y + Vy * look, k = 1 - Math.exp(-dt * (mode === 1 ? 5.5 : 4.2));
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    let tr = camTargetRot(c), d = tr - cam.rot; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; cam.rot += d * (1 - Math.exp(-dt * 3.2)); if (mode !== 1) cam.rot = tr;
    const speedZoom = 1 - 0.3 * clamp(c.speed / 55, 0, 1), target = app.settings.zoom * speedZoom * (mode === 2 ? 0.62 : 1);
    cam.zoom += (target - cam.zoom) * (1 - Math.exp(-dt * 2.5)); cam.anchor = mode === 1 ? 0.68 : 0.5;
    cam.shake = Math.max(0, cam.shake - dt * 2.6);
  }

  /* ---------- effects ---------- */
  function spawnFx(rc, dt) {
    const c = rc.c, fx = app.fx, cosT = Math.cos(c.th), sinT = Math.sin(c.th), a = rc.car.len / 2, W = rc.car.wid / 2 - 0.12;
    const rear = [[-a * 0.62, -W], [-a * 0.62, W]], front = [[a * 0.62, -W], [a * 0.62, W]];
    const low = app.settings.particles === 'low' || app.reducedMotion;
    const wp = (lx, ly) => [c.x + lx * cosT - ly * sinT, c.y + lx * sinT + ly * cosT];
    rear.forEach((w, i) => { const p = wp(w[0], w[1]); fx.skid(rc.carId + rc.name + 'r' + i, p[0], p[1], c.skid > 0.25 && c.speed > 3 ? c.skid * 0.62 : 0);
      if (c.skid > 0.22 && c.speed > 4 && Math.random() < (low ? 0.25 : 0.55) * c.skid * 60 * dt) { const dust = c.onSurface < 0.9; fx.smoke(p[0], p[1], -Math.cos(c.th) * 1.5 + (Math.random() - 0.5) * 2, -Math.sin(c.th) * 1.5 + (Math.random() - 0.5) * 2, 0.5 + c.skid * 0.4, dust ? '#a58d66' : '#dcdcdc', 0.8 + Math.random() * 0.8, dust ? 0.4 : 0.34); } });
    front.forEach((w, i) => { const p = wp(w[0], w[1]); fx.skid(rc.carId + rc.name + 'f' + i, p[0], p[1], c.slipF > 1.7 && c.speed > 6 ? Math.min(0.5, (c.slipF - 1.4) * 0.3) : 0); });
    if (c.onSurface < 0.9 && c.speed > 5 && Math.random() < 20 * dt * (low ? 0.4 : 1)) { const p = wp(-a * 0.5, (Math.random() - 0.5) * W * 2); fx.smoke(p[0], p[1], (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.5, '#8d7a58', 0.9, 0.3); }
  }
  function sparks(rc, impact) {
    const c = rc.c, n = app.reducedMotion ? 4 : Math.min(26, 6 + Math.round(impact * 1.5));
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 9; app.fx.spark(c.x + Math.cos(c.th) * 0.8 * (Math.random() - 0.5) * 3, c.y + Math.sin(c.th) * 0.8 * (Math.random() - 0.5) * 3, Math.cos(a) * v + c.vx * Math.cos(c.th) * 0.3, Math.sin(a) * v + c.vx * Math.sin(c.th) * 0.3); }
  }

  /* ---------- simulate one frame ---------- */
  function handleEvents(r) {
    const p = r.player;
    for (const e of r.events) {
      if (e.type === 'count') { Audio.play.count(e.n); app.hud.count = e.n; }
      else if (e.type === 'go') { Audio.play.count(0); app.hud.count = 0; setTimeout(() => { if (app.hud.count === 0) app.hud.count = null; }, 700); }
      else if (e.type === 'checkpoint') { Audio.play.checkpoint(); let txt = 'CHECKPOINT ' + (e.index + 1) + ' / ' + e.total; const rec = app.save.records[r.track.id]; const best = rec && rec.time && rec.time.splits; if (best && best[e.index] != null && app.run && app.run.mode !== 'drift') { const d = e.time - best[e.index]; txt += '   ' + (d <= 0 ? '' : '+') + d.toFixed(2); app.hud.banner = { text: txt, t: 2.2, color: d <= 0 ? '#7be07b' : '#ff7a5a' }; } else app.hud.banner = { text: txt, t: 2.0, color: '#f2a53a' }; }
      else if (e.type === 'hit' && e.who === p) { Audio.play.hit(e.impact); sparks(p, e.impact); if (app.settings.shake && !app.reducedMotion) app.cam.shake = Math.min(1, e.impact / 14); }
      else if (e.type === 'hit') { sparks(e.who, e.impact * 0.6); }
      else if (e.type === 'bump' && e.who === p) { Audio.play.bump(e.impact); }
      else if (e.type === 'bank' && e.who === p) { Audio.play.bank(); app.hud.bankMsg = { text: '+' + e.points + ' BANKED', t: 2 }; }
      else if (e.type === 'lost' && e.who === p) { app.hud.lostMsg = { text: e.points > 20 ? 'CHAIN LOST  -' + e.points : 'CRASH', t: 2 }; }
      else if (e.type === 'transition' && e.who === p) { app.hud.banner = { text: 'TRANSITION  ×' + e.combo.toFixed(1), t: 1.1, color: '#7be07b' }; }
      else if (e.type === 'finish') { app.hud.banner = { text: 'FINISH', t: 2.4, color: '#f4f1e8' }; }
    }
  }

  function simulate(dt) {
    const r = app.race;
    if (!r) { if (app.demo) stepDemo(dt); return; }
    if (app.paused) return;
    app.acc += dt; let n = 0;
    while (app.acc >= P.DT && n++ < 12) { Race.step(r, readInput()); app.acc -= P.DT; handleEvents(r); if (r.done) break; }
    if (n >= 12) app.acc = 0;
    const p = r.player; if (r.state === 'finished' && !app.results) { finishRun(); return; }
    updateCamera(p.c, dt);
    for (const rc of r.racers) spawnFx(rc, dt);
    app.fx.update(dt);
    // audio follows the player's car
    const c = p.c; Audio.update(r.state === 'countdown' ? { rpm: 0.2 + 0.05 * Math.sin(app.now * 9), throttle: 0.1, skid: 0, speed: 0, spin: 0 } : { rpm: c.rpm, throttle: c.thr || 0, skid: c.skid, speed: c.speed, offroad: c.onSurface < 0.9, spin: c.spin });
    // HUD timers
    const hd = app.hud; for (const k of ['banner', 'hint', 'bankMsg', 'lostMsg']) if (hd[k]) { hd[k].t -= dt; if (hd[k].t <= 0) hd[k] = null; }
    if (r.state === 'running' && hd.count != null && hd.count > 0) { /* countdown digits are re-set by events */ }
  }
  function stepDemo(dt) {
    const r = app.demo; app.acc += dt; let n = 0; while (app.acc >= P.DT && n++ < 12) { Race.step(r, null); app.acc -= P.DT; } if (n >= 12) app.acc = 0;
    const c = r.player.c; if (r.done || (r.player.finished && r.t > r.doneAt + 2)) startDemo(app.track.id);
    updateCamera(c, dt); for (const rc of r.racers) spawnFx(rc, dt); app.fx.update(dt);
  }

  /* ---------- render ---------- */
  function render() {
    const r = app.race || app.demo; if (!r || !R.track) { R.ctx.setTransform(1, 0, 0, 1, 0, 0); R.ctx.fillStyle = '#0a0b0e'; R.ctx.fillRect(0, 0, els.canvas.width, els.canvas.height); return; }
    const cam = Object.assign({}, app.cam);
    if (app.cam.shake > 0) { cam.x += (Math.random() - 0.5) * app.cam.shake * 1.2; cam.y += (Math.random() - 0.5) * app.cam.shake * 1.2; }
    if (!app.race) { cam.zoom *= 0.85; cam.anchor = 0.5; }
    R.drawWorld({ cam, race: r, fx: app.fx, settings: app.settings });
    if (app.race) R.drawHUD(buildHud(app.race));
    else if (app.screen !== 'race') { /* menu backdrop: soften */ R.ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0); R.ctx.fillStyle = 'rgba(6,7,10,0.18)'; R.ctx.fillRect(0, 0, R.W, R.H); }
  }
  function buildHud(r) {
    const p = r.player, c = p.c, run = app.run || {}, mode = r.mode, tr = r.track, hd = app.hud;
    const k = app.settings.units === 'mph' ? 2.23694 : 3.6;
    const rec = app.save.records[tr.id], best = mode === 'drift' ? null : rec && rec.time ? rec.time.value : null;
    const field = r.racers.length;
    const label = (mode === 'time' ? 'TIME ATTACK' : mode === 'drift' ? 'DRIFT ATTACK' : 'RIVAL BATTLE') + ' · ' + tr.name.toUpperCase();
    const d = p.drift;
    const time = r.state === 'countdown' ? 0 : p.finished ? p.finishTime : r.t + p.penalty;
    let warn = null; if (p.wrong && r.state === 'running') warn = 'WRONG WAY'; else if (p.offRoad > 1.2 && r.state === 'running') warn = 'OFF ROAD';
    return { label, time, penalty: p.penalty, cp: Math.min(p.nextCp, tr.checkpoints.length - 1), cpTotal: tr.checkpoints.length - 1, progress: clamp((p.s - tr.startS) / tr.raceLength, 0, 1), best,
      place: mode === 'rival' ? p.place : 0, field, speed: c.speed * k, rpm: c.rpm, gear: c.vx < -0.5 ? 0 : c.gear, units: app.settings.units, mode,
      drift: d ? { score: d.score, chain: d.chain, combo: d.combo, active: d.active, zone: d.zone, angle: d.angle, bankMsg: hd.bankMsg && hd.bankMsg.text, lostMsg: hd.lostMsg && hd.lostMsg.text } : null,
      dots: r.racers.map(rc => ({ x: rc.c.x, y: rc.c.y, me: rc.human, color: rc.color })), count: r.state === 'countdown' ? Math.max(1, Math.ceil(-r.clock)) : hd.count, banner: hd.banner, hint: hd.hint, warn };
  }

  function frame(t) {
    const now = t / 1000, dt = Math.min(0.1, app.last ? now - app.last : 0.016); app.last = now; app.now = now;
    try { simulate(dt); render(); } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }

  /* ---------- public API for the UI ---------- */
  const api = {
    app, inputOverride: null, ASSIST_NAMES, CAMERAS, startRun, restartRun, leaveRun, togglePause, resume() { if (app.paused) togglePause(); },
    applySettings, setMuted, startDemo, showTrack,
    saveNow() { Save.store(app.save); },
    exportSave() { Save.store(app.save); return Save.exportAll(); },
    importSave(obj) { const r = Save.importAll(obj); if (r.ok) { app.save = Save.load(); app.settings = Save.loadSettings(); applySettings(); } return r; },
    resetSave() { Save.reset(); app.save = Save.load(); app.settings = Save.loadSettings(); applySettings(); Save.store(app.save); },
    unlockAudio() { if (!app.audioStarted) { app.audioStarted = true; Audio.ensure(); } Audio.resume(); },
    inRace() { return !!app.race && app.race.state !== 'finished' && !app.results; },
  };

  function init() {
    els.canvas = document.getElementById('view'); app.fx = TD.Render.createFx(); R = TD.Render.create(els.canvas);
    app.save = Save.load(); app.settings = Save.loadSettings();
    const lp = launcherPrefs(); app.startMuted = !!lp.startMuted;                      // the Library's "start games muted": muted each launch until you press Sound
    app.reducedMotion = lp.motion === 'on' || (lp.motion !== 'off' && globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (app.reducedMotion) { app.settings = Object.assign({}, app.settings, { shake: false }); }
    Audio.setVolume(app.settings.volume); Audio.setMuted(app.settings.muted || app.startMuted);
    R.resize(); globalThis.addEventListener('resize', () => R.resize());
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => R.resize()).observe(els.canvas);
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { app.keys = {}; if (app.screen === 'race' && app.race && app.race.state === 'running' && !app.paused) togglePause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { Audio.suspend(); if (app.screen === 'race' && app.race && !app.paused && app.race.state === 'running') togglePause(); } else Audio.resume(); });
    window.addEventListener('pointerdown', () => api.unlockAudio(), { once: false });
    window.addEventListener('beforeunload', e => { if (api.inRace() && !app.leaving) { e.preventDefault(); e.returnValue = ''; } });
    UI = TD.UI.create(api); startDemo('pine-ridge'); UI.show('title');
    requestAnimationFrame(frame);
    globalThis.__td = { api, app, TD };
  }
  TD.Game = api; TD.initGame = init;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
