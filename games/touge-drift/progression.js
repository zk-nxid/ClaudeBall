/* Touge Drift - progression, economy and saves. Pure logic + a small storage layer (no DOM).
 *   Store     localStorage wrapper that never throws (falls back to memory when storage is blocked)
 *   Save      versioned save data (key td.save.v1) with sanitising and safe migration
 *   Progress  career regions/events, medals, rewards, unlocks, garage purchases
 * All keys start with "td." so the launcher can export/import this game's data as a group. */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const V = () => TD.Vehicles;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ---------- storage ---------- */
  const mem = {};
  const Store = {
    ok: true,
    get(k) { try { const v = globalThis.localStorage.getItem(k); return v === null ? (k in mem ? mem[k] : null) : v; } catch (e) { Store.ok = false; return k in mem ? mem[k] : null; } },
    set(k, v) { try { globalThis.localStorage.setItem(k, v); delete mem[k]; return true; } catch (e) { Store.ok = false; mem[k] = v; return false; } },
    remove(k) { try { globalThis.localStorage.removeItem(k); } catch (e) { /* ignore */ } delete mem[k]; },
    keys() { try { const o = []; for (let i = 0; i < globalThis.localStorage.length; i++) o.push(globalThis.localStorage.key(i)); return o; } catch (e) { return Object.keys(mem); } },
    json(k, dflt) { try { const s = Store.get(k); return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } },
  };

  /* ---------- save data ---------- */
  const SAVE_KEY = 'td.save.v1', SETTINGS_KEY = 'td.settings.v1', GHOST_PREFIX = 'td.ghost.v1.';
  const START_CREDITS = 3000;
  const defaultSave = () => ({ v: 1, credits: START_CREDITS, owned: { 'kazan-rz1': V().defaultBuild() }, selected: 'kazan-rz1',
    career: { events: {} }, records: {}, stats: { runs: 0, finishes: 0, wins: 0, driftPoints: 0, bestDriftChain: 0, metres: 0, creditsEarned: 0 }, created: Date.now() });
  const defaultSettings = () => ({ v: 1, volume: 0.7, muted: false, assist: 2, camera: 0, zoom: 1, units: 'kmh', shake: true, particles: 'high', rotation: true });

  function sanitizeBuild(b) {
    const d = V().defaultBuild(); b = b && typeof b === 'object' ? b : {};
    const n = (v, lo, hi, dv) => Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : dv;
    return { engine: n(b.engine, 0, 3, 0), susp: n(b.susp, 0, 3, 0), tires: n(b.tires, 0, 3, d.tires), diffKit: !!b.diffKit, diffLock: Number.isFinite(b.diffLock) ? clamp(b.diffLock, 0, 1) : null,
             weight: n(b.weight, 0, 3, 0), paint: n(b.paint, 0, V().PAINTS.length - 1, 0), wheel: n(b.wheel, 0, V().WHEELS.length - 1, 0), wheelColor: n(b.wheelColor, 0, V().WHEEL_COLORS.length - 1, 0) };
  }
  function sanitize(s) {
    const d = defaultSave(); if (!s || typeof s !== 'object') return d;
    const out = defaultSave();
    out.credits = Number.isFinite(s.credits) ? Math.max(0, Math.floor(s.credits)) : d.credits;
    out.owned = {}; if (s.owned && typeof s.owned === 'object') for (const id of Object.keys(s.owned)) if (V().carById(id)) out.owned[id] = sanitizeBuild(s.owned[id]);
    if (!out.owned['kazan-rz1']) out.owned['kazan-rz1'] = V().defaultBuild();         // the starter car can never be lost
    out.selected = out.owned[s.selected] ? s.selected : 'kazan-rz1';
    out.career = { events: {} };
    if (s.career && s.career.events && typeof s.career.events === 'object') for (const id of Object.keys(s.career.events)) { const e = s.career.events[id]; if (e && Number.isFinite(e.medal)) out.career.events[id] = { medal: clamp(Math.round(e.medal), 0, 3), best: Number.isFinite(e.best) ? e.best : null }; }
    out.records = s.records && typeof s.records === 'object' ? s.records : {};
    out.stats = Object.assign(d.stats, s.stats && typeof s.stats === 'object' ? s.stats : {});
    out.created = Number.isFinite(s.created) ? s.created : d.created;
    return out;
  }
  const Save = {
    KEY: SAVE_KEY, SETTINGS_KEY, GHOST_PREFIX, defaultSave, defaultSettings, sanitize,
    load() {
      const raw = Store.get(SAVE_KEY); if (!raw) return defaultSave();
      let obj; try { obj = JSON.parse(raw); } catch (e) { Store.set('td.save.corrupt.' + Date.now(), raw); return defaultSave(); }   // keep the unreadable data, start fresh
      if (!obj || obj.v !== 1) { Store.set('td.save.backup.' + Date.now(), raw); return sanitize(obj); }                         // future/other version: back it up, then best-effort read
      return sanitize(obj);
    },
    store(s) { return Store.set(SAVE_KEY, JSON.stringify(s)); },
    loadSettings() { const s = Store.json(SETTINGS_KEY, null), d = defaultSettings(); if (!s || typeof s !== 'object') return d; return Object.assign(d, { volume: clamp(+s.volume || 0, 0, 1), muted: !!s.muted, assist: clamp(Math.round(+s.assist), 0, 3), camera: clamp(Math.round(+s.camera) || 0, 0, 2), zoom: clamp(+s.zoom || 1, 0.6, 1.8), units: s.units === 'mph' ? 'mph' : 'kmh', shake: s.shake !== false, particles: s.particles === 'low' ? 'low' : 'high', rotation: s.rotation !== false }); },
    storeSettings(s) { return Store.set(SETTINGS_KEY, JSON.stringify(s)); },
    loadGhost(courseId) { const g = Store.json(GHOST_PREFIX + courseId, null); return g && Array.isArray(g.data) && g.data.length >= 6 ? g : null; },
    storeGhost(courseId, g) { return Store.set(GHOST_PREFIX + courseId, JSON.stringify(g)); },
    /** All td.* entries as one plain object (used by export). */
    exportAll() { const o = {}; Store.keys().filter(k => k.startsWith('td.') && !k.startsWith('td.save.corrupt') ).forEach(k => { o[k] = Store.get(k); }); return { format: 'touge-drift-save', version: 1, exportedAt: new Date().toISOString(), entries: o }; },
    importAll(obj) {
      if (!obj || obj.format !== 'touge-drift-save' || obj.version !== 1 || !obj.entries || typeof obj.entries !== 'object') return { ok: false, error: 'This is not a Touge Drift save file.' };
      const keys = Object.keys(obj.entries).filter(k => k.startsWith('td.') && typeof obj.entries[k] === 'string');
      if (!keys.includes(SAVE_KEY)) return { ok: false, error: 'The file contains no save data.' };
      try { JSON.parse(obj.entries[SAVE_KEY]); } catch (e) { return { ok: false, error: 'The save inside the file is damaged.' }; }
      const prev = Store.get(SAVE_KEY); if (prev) Store.set('td.save.backup.' + Date.now(), prev);          // never overwrite without keeping a copy
      keys.forEach(k => Store.set(k, obj.entries[k]));
      return { ok: true, count: keys.length };
    },
    reset() { Store.keys().filter(k => k.startsWith('td.') && !k.startsWith('td.save.backup')).forEach(k => Store.remove(k)); },
  };

  /* ---------- career ---------- */
  const COURSE_IDS = () => TD.Tracks.COURSES.map(c => c.id);
  const BASE_REWARD = [1200, 1800, 2600, 3600, 4800, 6600];
  const MEDAL_MULT = [0, 1, 1.6, 2.4], MEDAL_NAMES = ['None', 'Bronze', 'Silver', 'Gold'];
  const PRACTICE_RATE = 0.1, STARS_TO_UNLOCK = 5;
  // par = time (s) a skill-0.85 AI needs in the stock starter car; medals are multiples of it (checked by the tests)
  const PAR = { 'pine-ridge': 89, 'moonlight-pass': 115, 'redline-canyon': 138, 'misty-summit': 158, 'blackpine-descent': 189, 'midnight-crown': 222 };
  const TIME_MEDAL = [0, 1.45, 1.25, 1.08];                    // bronze / silver / gold = par x ...
  const DRIFT_PER_KM = [0, 700, 1700, 3200];                   // drift points per km of race distance
  const RIVAL_NAMES = ['Kenji', 'Aoi', 'Takumi', 'Mika', 'Daichi', 'Rin', 'Sota', 'Yuna', 'Haruto', 'Ren', 'Kaede', 'Shin', 'Akari', 'Joe', 'Hana'];
  const RIVAL_COLORS = ['#c4231c', '#1c6fd1', '#2f9e5b', '#f0c230', '#6a3fb0', '#27d1c8', '#e65a9a', '#e8761d'];
  const RIVAL_CARS = [['sora-hatch', 'kazan-rz1'], ['hayate-rd', 'tsurugi-rs4'], ['tsurugi-rs4', 'orochi-tgt', 'kazan-rz1'], ['orochi-tgt', 'tsurugi-rs4', 'ryujin-drx'], ['ryujin-drx', 'raiden-gtawd', 'orochi-tgt'], ['raiden-gtawd', 'hakuba-zero', 'ryujin-drx']];
  const RIVAL_SKILL = [[0.5, 0.58], [0.62, 0.7], [0.7, 0.77], [0.77, 0.83], [0.83, 0.9], [0.9, 0.96]];

  /** The 24 career events: 4 per region. */
  function buildEvents() {
    const out = [];
    COURSE_IDS().forEach((cid, i) => {
      const r = i + 1, base = BASE_REWARD[i];
      out.push({ id: 'r' + r + '-time', region: r, course: cid, mode: 'time', title: 'Time Attack', blurb: 'Reach the bottom against the clock.', base });
      out.push({ id: 'r' + r + '-drift', region: r, course: cid, mode: 'drift', title: 'Drift Attack', blurb: 'Chain drifts for points on the way down.', base });
      out.push({ id: 'r' + r + '-rival', region: r, course: cid, mode: 'rival', rivals: 1, title: 'Rival Battle', blurb: 'One local legend wants your spot.', base: Math.round(base * 1.1) });
      out.push({ id: 'r' + r + '-boss', region: r, course: cid, mode: 'rival', rivals: 3, boss: true, title: 'Region Final', blurb: 'Three rivals, one winner.', base: Math.round(base * 1.4) });
    });
    return out;
  }
  const EVENTS = () => EVENTS._c || (EVENTS._c = buildEvents());
  const eventById = id => EVENTS().find(e => e.id === id);

  function thresholds(courseId, mode) {
    const T = TD.Tracks.COURSES.find(c => c.id === courseId); const track = Progress._tr && Progress._tr[courseId];
    if (mode === 'time') { const par = PAR[courseId]; return TIME_MEDAL.map((m, k) => k ? Math.round(par * m * 10) / 10 : null); }
    if (mode === 'drift') { const km = lengthKm(courseId); return DRIFT_PER_KM.map((m, k) => k ? Math.round(m * km / 50) * 50 : null); }
    return null;
  }
  const lengthKm = id => { const t = Progress.track(id); return t.raceLength / 1000; };

  /** Medal (0..3) for a finished run. Time: lower is better; drift: higher; rival: finishing place vs field. */
  function medalFor(mode, courseId, result) {
    if (!result || !result.finished) return 0;
    if (mode === 'time') { const th = thresholds(courseId, 'time'); return result.time <= th[3] ? 3 : result.time <= th[2] ? 2 : result.time <= th[1] ? 1 : 0; }
    if (mode === 'drift') { const th = thresholds(courseId, 'drift'); return result.driftScore >= th[3] ? 3 : result.driftScore >= th[2] ? 2 : result.driftScore >= th[1] ? 1 : 0; }
    if (mode === 'rival') return result.place === 1 ? 3 : result.place === 2 ? 2 : result.place === 3 ? 1 : 0;
    return 0;
  }

  const stars = (s, region) => EVENTS().filter(e => e.region === region).reduce((n, e) => n + ((s.career.events[e.id] || {}).medal || 0), 0);
  const regionUnlocked = (s, region) => region <= 1 || stars(s, region - 1) >= STARS_TO_UNLOCK;
  const regionsUnlocked = s => { let n = 1; while (n < 6 && regionUnlocked(s, n + 1)) n++; return n; };
  const carUnlocked = (s, car) => (car.unlock.region || 1) <= regionsUnlocked(s);
  const courseUnlocked = (s, courseId) => regionUnlocked(s, COURSE_IDS().indexOf(courseId) + 1);

  function rivalsFor(ev, n) {
    const reg = ev.region - 1, R = TD.Tracks.rng(ev.region * 131 + (ev.boss ? 7 : 3)), count = n == null ? ev.rivals : n;
    const names = RIVAL_NAMES.slice().sort(() => R() - 0.5), list = [], cars = RIVAL_CARS[reg], sk = RIVAL_SKILL[reg];
    const stage = Math.min(3, Math.floor(reg / 2));
    for (let i = 0; i < count; i++) {
      const skill = ev.boss ? sk[1] - 0.02 * (count - 1 - i) : sk[0] + (sk[1] - sk[0]) * (count === 1 ? 0.5 : i / (count - 1));
      list.push({ name: names[i], carId: cars[i % cars.length], skill: Math.round(skill * 100) / 100, color: RIVAL_COLORS[(i + reg * 3) % RIVAL_COLORS.length],
        build: Object.assign(V().defaultBuild(), { engine: stage, susp: stage, tires: Math.min(2, 1 + Math.floor(reg / 3)) }) });
    }
    return list;
  }

  /** Apply a finished run to the save. ctx: { mode, courseId, eventId|null, carId }. Returns what happened (for the results screen). */
  function applyResult(s, ctx, result) {
    const out = { medal: 0, reward: 0, firstTime: false, improved: false, newRecord: [], unlocks: [], eventId: ctx.eventId || null };
    s.stats.runs++;
    if (!result.finished) return out;
    s.stats.finishes++; if (result.place === 1 && result.field > 1) s.stats.wins++;
    s.stats.driftPoints += result.driftScore || 0; s.stats.bestDriftChain = Math.max(s.stats.bestDriftChain, result.bestDrift || 0);
    s.stats.metres += Math.round(Progress.track(ctx.courseId).raceLength);
    const medal = medalFor(ctx.mode, ctx.courseId, result); out.medal = medal;
    const ci = COURSE_IDS().indexOf(ctx.courseId), region = ci + 1;
    const before = regionsUnlocked(s), carsBefore = V().CARS.filter(c => carUnlocked(s, c)).length;
    // records (every mode)
    const rec = s.records[ctx.courseId] = s.records[ctx.courseId] || {};
    if (ctx.mode === 'time' || ctx.mode === 'rival') { if (!rec.time || result.time < rec.time.value) { rec.time = { value: result.time, carId: ctx.carId }; out.newRecord.push('time'); } }
    if (ctx.mode === 'drift') { if (!rec.drift || result.driftScore > rec.drift.value) { rec.drift = { value: result.driftScore, carId: ctx.carId }; out.newRecord.push('drift'); } }
    let reward = 0;
    if (ctx.eventId) {
      const ev = eventById(ctx.eventId), prev = s.career.events[ev.id] || { medal: 0, best: null };
      reward = Math.round(ev.base * MEDAL_MULT[medal] * 0.15);                                    // a small payout for every finish...
      if (medal > prev.medal) {                                                                   // ...plus the difference when a better medal is earned
        reward += Math.round(ev.base * (MEDAL_MULT[medal] - MEDAL_MULT[prev.medal])); out.improved = true; out.firstTime = prev.medal === 0;
        s.career.events[ev.id] = { medal, best: ctx.mode === 'drift' ? result.driftScore : result.time };
      } else if (!s.career.events[ev.id]) s.career.events[ev.id] = { medal: 0, best: null };
    } else {
      reward = Math.round(BASE_REWARD[ci] * PRACTICE_RATE * MEDAL_MULT[medal] + BASE_REWARD[ci] * 0.01);   // practice runs pay a little
    }
    out.reward = reward; s.credits += reward; s.stats.creditsEarned += reward;
    const after = regionsUnlocked(s);
    for (let r = before + 1; r <= after; r++) out.unlocks.push({ type: 'region', name: TD.Tracks.COURSES[r - 1].name });
    V().CARS.filter(c => carUnlocked(s, c)).slice(carsBefore).forEach(c => out.unlocks.push({ type: 'car', name: c.name }));
    return out;
  }

  /* ---------- garage ---------- */
  function buyCar(s, carId) {
    const car = V().carById(carId); if (!car) return { ok: false, error: 'Unknown car.' };
    if (s.owned[carId]) return { ok: false, error: 'You already own this car.' };
    if (!carUnlocked(s, car)) return { ok: false, error: 'Unlock ' + TD.Tracks.COURSES[car.unlock.region - 1].name + ' first.' };
    if (s.credits < car.price) return { ok: false, error: 'Not enough credits.' };
    s.credits -= car.price; s.owned[carId] = V().defaultBuild(); return { ok: true };
  }
  /** kind: 'engine' | 'susp' | 'weight' (stage n, must be the next stage), 'tires' (compound index), 'diffKit'. */
  function buyUpgrade(s, carId, kind, stage) {
    const car = V().carById(carId), b = s.owned[carId]; if (!car || !b) return { ok: false, error: 'You do not own this car.' };
    if (kind === 'diffKit') { if (b.diffKit) return { ok: false, error: 'Already installed.' }; const c = V().upgradeCost(car, 'diffKit'); if (s.credits < c) return { ok: false, error: 'Not enough credits.' }; s.credits -= c; b.diffKit = true; b.diffLock = car.diff; return { ok: true, cost: c }; }
    if (kind === 'tires') {
      if (stage < 0 || stage > 3) return { ok: false, error: 'Bad tyre.' }; if (b.tires === stage) return { ok: false, error: 'Already fitted.' };
      const owned = (b.tiresOwned || []).includes(stage) || stage <= 1; const c = owned ? 0 : V().upgradeCost(car, 'tires', stage);
      if (s.credits < c) return { ok: false, error: 'Not enough credits.' }; s.credits -= c; if (!owned) { b.tiresOwned = (b.tiresOwned || []).concat(stage); } b.tires = stage; return { ok: true, cost: c };
    }
    if (!['engine', 'susp', 'weight'].includes(kind)) return { ok: false, error: 'Unknown upgrade.' };
    if (stage !== b[kind] + 1 || stage > 3) return { ok: false, error: 'Buy the stages in order.' };
    const c = V().upgradeCost(car, kind, stage); if (s.credits < c) return { ok: false, error: 'Not enough credits.' };
    s.credits -= c; b[kind] = stage; return { ok: true, cost: c };
  }
  const sellValue = (car, b) => Math.round(car.price * 0.45 / 50) * 50;
  function select(s, carId) { if (!s.owned[carId]) return false; s.selected = carId; return true; }
  function setCosmetic(s, carId, key, value) { const b = s.owned[carId]; if (!b || !['paint', 'wheel', 'wheelColor'].includes(key)) return false; b[key] = value; return true; }
  function setDiff(s, carId, lock) { const b = s.owned[carId]; if (!b || !b.diffKit) return false; b.diffLock = clamp(lock, 0, 1); return true; }

  const trackCache = {};
  const Progress = { COURSE_IDS, EVENTS, eventById, thresholds, medalFor, stars, regionUnlocked, regionsUnlocked, carUnlocked, courseUnlocked, rivalsFor, applyResult,
    buyCar, buyUpgrade, select, setCosmetic, setDiff, sellValue, BASE_REWARD, MEDAL_MULT, MEDAL_NAMES, STARS_TO_UNLOCK, PAR, START_CREDITS,
    track(id) { return trackCache[id] || (trackCache[id] = TD.Tracks.build(id)); } };
  TD.Store = Store; TD.Save = Save; TD.Progress = Progress;
})();
