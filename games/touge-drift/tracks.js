/* Touge Drift - the six mountain courses. Pure data + geometry (no DOM): runs in Node for the tests.
 *
 * A course is generated, deterministically, from a seed and a "style" (see COURSES): a serpentine of legs joined by
 * hairpins, with bends in between. Curvature changes smoothly (ramped, clothoid-like), so the road has no kinks. The
 * generator re-tries nearby seeds until the road does not come close to itself, so every course is finishable.
 *
 * Units: metres. y points down (canvas). Heading theta is clockwise-positive. Right normal of heading t is (-sin t, cos t).
 * The road is sampled every DS metres; `query()` maps a world point to the road (arc length s, signed offset, + = right). */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const DS = 2;
  const START_S = 40, RUNOFF = 130;          // start line 40 m from the road's end; 130 m of run-off after the finish line

  function rng(seed) {                        // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* difficulty: medals use `ref` (AI reference time, seconds) filled in by tools/ref-times; see progression.js */
  const COURSES = [
    { id: 'pine-ridge', name: 'Pine Ridge', region: 'Pine Ridge', tag: 'Beginner', seed: 11, length: 1600, hairpins: 3, hpR: [21, 24], bendR: [75, 140], bendA: [16, 44], bends: [2, 3], straight: [70, 170], width: 13.0,
      look: { sky: '#b9a07a', ground: '#34502f', ground2: '#3d5d37', road: '#46464b', line: '#e8e2cf', shoulder: '#5f5a4a', rail: '#aeb4bb', tree: ['#1f4a2a', '#2a5e35', '#173d23'], rock: '#6d6f6a', dark: 0.28, fog: 0, kind: 'pine', density: 1.0, glow: '#ffb347' } },
    { id: 'moonlight-pass', name: 'Moonlight Pass', region: 'Moonlight Pass', tag: 'Intermediate', seed: 23, length: 1900, hairpins: 4, hpR: [19, 22], bendR: [55, 105], bendA: [20, 52], bends: [2, 4], straight: [55, 140], width: 12.4,
      look: { sky: '#101a3a', ground: '#162a3a', ground2: '#1b3446', road: '#2a2e3a', line: '#cfd8ec', shoulder: '#384153', rail: '#9fb2c8', tree: ['#10303c', '#16414a', '#0d2530'], rock: '#46566a', dark: 0.52, fog: 0.04, kind: 'pine', density: 0.9, glow: '#bcd4ff' } },
    { id: 'redline-canyon', name: 'Redline Canyon', region: 'Redline Canyon', tag: 'Technical', seed: 37, length: 2150, hairpins: 5, hpR: [17, 20], bendR: [40, 80], bendA: [26, 62], bends: [3, 5], straight: [45, 110], width: 11.9,
      look: { sky: '#d96b3b', ground: '#7a4a32', ground2: '#8a5738', road: '#3c3a40', line: '#f2e6c8', shoulder: '#8a6a4a', rail: '#c9c1b6', tree: ['#7a6a2c', '#5f6a2c', '#8a7a34'], rock: '#a0462e', dark: 0.34, fog: 0.03, kind: 'canyon', density: 0.55, glow: '#ff8a3c' } },
    { id: 'misty-summit', name: 'Misty Summit', region: 'Misty Summit', tag: 'Advanced', seed: 53, length: 2400, hairpins: 6, hpR: [16, 19], bendR: [34, 68], bendA: [28, 66], bends: [3, 5], straight: [40, 100], width: 11.6,
      look: { sky: '#a9b8c4', ground: '#59675f', ground2: '#667567', road: '#3d4348', line: '#f0f3f5', shoulder: '#6e776f', rail: '#d3dadf', tree: ['#3c5348', '#4a6355', '#2f463c'], rock: '#8a9490', dark: 0.3, fog: 0.5, kind: 'mist', density: 0.7, glow: '#e8f2ff' } },
    { id: 'blackpine-descent', name: 'Blackpine Descent', region: 'Blackpine Descent', tag: 'Expert', seed: 71, length: 2650, hairpins: 7, hpR: [15, 18], bendR: [30, 58], bendA: [30, 72], bends: [3, 6], straight: [35, 90], width: 11.0,
      look: { sky: '#05080a', ground: '#0e1713', ground2: '#121e19', road: '#202327', line: '#bfc7cc', shoulder: '#262d29', rail: '#7f8890', tree: ['#07110c', '#0a1a12', '#050d09'], rock: '#232b2d', dark: 0.7, fog: 0.08, kind: 'pine', density: 1.5, glow: '#ffd9a0' } },
    { id: 'midnight-crown', name: 'Midnight Crown', region: 'Midnight Crown', tag: 'Final Challenge', seed: 97, length: 2950, hairpins: 9, hpR: [14, 17], bendR: [26, 48], bendA: [32, 78], bends: [4, 6], straight: [30, 80], width: 10.6,
      look: { sky: '#07041a', ground: '#14102b', ground2: '#1a1538', road: '#17171f', line: '#f2d27a', shoulder: '#231e3c', rail: '#c8a8ff', tree: ['#16103a', '#1c1546', '#110b2c'], rock: '#2a2350', dark: 0.62, fog: 0.05, kind: 'crown', density: 0.8, glow: '#ff5ac8' } },
  ];

  /* ---------- centreline from a curvature profile ---------- */
  function pushCurve(ks, ang, r, dir) {                // a bend of total turn `ang` (rad) at peak radius r, with clothoid-style ramps
    const kmax = 1 / r, ramp = Math.min(r * 1.1, Math.abs(ang) * r * 0.45);
    let hold = Math.abs(ang) / kmax - ramp;
    let rp = ramp; if (hold < 0) { rp = Math.abs(ang) * r / 2; hold = 0; }
    const n1 = Math.max(2, Math.round(rp / DS)), n2 = Math.max(0, Math.round(hold / DS));
    const fix = Math.abs(ang) / (kmax * DS * (n1 + n2));       // rescale so the heading change is exact
    for (let i = 0; i < n1; i++) { const t = (i + 0.5) / n1; ks.push(dir * kmax * smooth(t) * fix); }
    for (let i = 0; i < n2; i++) ks.push(dir * kmax * fix);
    for (let i = 0; i < n1; i++) { const t = 1 - (i + 0.5) / n1; ks.push(dir * kmax * smooth(t) * fix); }
  }
  const smooth = t => t * t * (3 - 2 * t);
  const pushStraight = (ks, len) => { const n = Math.max(1, Math.round(len / DS)); for (let i = 0; i < n; i++) ks.push(0); };

  /* Incremental builder: every bend is integrated first and only kept if the new road stays clear of the road already laid
   * (so the course can never cross or squeeze past itself). Returns the curvature list, or null if it painted itself into a corner. */
  function buildCurvature(def, attempt, need) {
    const R = rng(def.seed * 1000 + attempt * 7919 + 13), U = (a, b) => a + (b - a) * R();
    const ks = [], CELL = 40, grid = new Map(), key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
    const xs = [0], ys = [0]; let x = 0, y = 0, h = 0;
    const add = i => { const k = key(Math.floor(xs[i] / CELL), Math.floor(ys[i] / CELL)); (grid.get(k) || grid.set(k, []).get(k)).push(i); };
    add(0);
    /** Try to lay `seq` (curvatures). Commits and returns true if it keeps `need` metres from older road. */
    function lay(seq) {
      let tx = x, ty = y, th = h; const np = [];
      const base = xs.length - 1;
      for (let q = 0; q < seq.length; q++) {
        const k = seq[q]; th += k * DS * 0.5; tx += Math.cos(th) * DS; ty += Math.sin(th) * DS; th += k * DS * 0.5;
        const idx = base + q + 1;
        const cx = Math.floor(tx / CELL), cy = Math.floor(ty / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = grid.get(key(cx + dx, cy + dy)); if (!arr) continue;
          for (const j of arr) if (idx - j > 90 && (xs[j] - tx) * (xs[j] - tx) + (ys[j] - ty) * (ys[j] - ty) < need * need) return false; }
        np.push(tx, ty);
      }
      // new points must also keep clear of each other (a long spiral could fold onto itself)
      for (let q = 0; q < seq.length; q++) ks.push(seq[q]);
      for (let q = 0; q < seq.length; q++) { xs.push(np[q * 2]); ys.push(np[q * 2 + 1]); add(xs.length - 1); }
      // heading/pos after the sequence
      let ch = h; for (let q = 0; q < seq.length; q++) ch += seq[q] * DS;
      x = np[np.length - 2]; y = np[np.length - 1]; h = ch;
      return true;
    }
    const straight = len => { const a = []; const n = Math.max(1, Math.round(len / DS)); for (let i = 0; i < n; i++) a.push(0); return a; };
    const bend = (ang, r, dir) => { const a = []; pushCurve(a, ang, r, dir); return a; };
    if (!lay(straight(START_S + 60))) return null;
    const legs = def.hairpins + 1, hpAvg = (def.hpR[0] + def.hpR[1]) / 2, hpLen = Math.PI * hpAvg + 68 + 125;   // + the offset S-bend after each hairpin
    let dirH = -1, budget = def.length - (START_S + 60) - (70 + RUNOFF);
    for (let leg = 0; leg < legs; leg++) {
      const legsLeft = legs - leg, hpsLeft = def.hairpins - leg;
      const target = Math.max(80, (budget - hpsLeft * hpLen) / legsLeft);
      const start = ks.length; let hdOff = 0, bendDir = R() < 0.5 ? 1 : -1, guard = 0;
      while ((ks.length - start) * DS < target - 40 && guard++ < 40) {
        let gap = U(def.straight[0], def.straight[1]); const r = U(def.bendR[0], def.bendR[1]);
        let ang = U(def.bendA[0], def.bendA[1]) * Math.PI / 180, d = bendDir, ok = false;
        const rem = target - (ks.length - start) * DS, bl = ang * r * 1.1;             // stay inside this leg's share of the course length
        if (rem < bl + 30) break;
        gap = Math.min(gap, Math.max(12, rem - bl - 10));
        for (let t = 0; t < 8 && !ok; t++) {
          if (Math.abs(hdOff + d * ang) > 55 * Math.PI / 180) d = -d;
          const seq = straight(gap).concat(bend(ang, r, d));
          if (lay(seq)) { hdOff += d * ang; ok = true; bendDir = -d; }
          else { d = -d; ang *= 0.8; }
        }
        if (!ok) lay(straight(20));
        // sometimes an S-bend straight back the other way
        if (ok && R() < 0.2 && (ks.length - start) * DS < target - 120) { const a2 = U(def.bendA[0], def.bendA[1]) * Math.PI / 180; if (lay(bend(a2, U(def.bendR[0], def.bendR[1]), bendDir))) { hdOff += bendDir * a2; bendDir = -bendDir; } }
      }
      if (Math.abs(hdOff) > 0.02) {                                        // straighten out to the leg's base heading
        let done = false; for (let t = 0; t < 6 && !done; t++) done = lay(bend(Math.abs(hdOff), U(def.bendR[0], def.bendR[1]) * (1 + t * 0.3), -Math.sign(hdOff)));
        if (!done) return null;
      }
      const fill = target - (ks.length - start) * DS; if (fill > 4) lay(straight(fill));
      if (leg < def.hairpins) {
        let done = false;
        for (let t = 0; t < 10 && !done; t++) done = lay(straight(U(26, 42)).concat(bend(Math.PI, U(def.hpR[0], def.hpR[1]), dirH), straight(U(26, 42))));   // generous run-in and run-out
        if (!done) return null;
        // an offset S-bend away from the leg we just turned back on, so neighbouring legs are well apart
        for (let t = 0; t < 5; t++) { const aS = U(28, 44) * Math.PI / 180, rS = U(70, 120) * (1 - t * 0.12);
          if (lay(bend(aS, rS, -dirH).concat(straight(U(8, 18)), bend(aS, rS, dirH)))) break; }
        dirH = -dirH;
      }
      budget = def.length - (START_S + 60) - (70 + RUNOFF) - ((ks.length - (START_S + 60) / DS) * DS);
    }
    if (!lay(straight(70 + RUNOFF))) return null;
    return ks;
  }

  function integrate(ks) {
    const n = ks.length + 1, px = new Float64Array(n), py = new Float64Array(n), hd = new Float64Array(n), kp = new Float64Array(n);
    let x = 0, y = 0, h = 0;
    for (let i = 0; i < n; i++) {
      px[i] = x; py[i] = y; hd[i] = h; const k = i < ks.length ? ks[i] : 0; kp[i] = k;
      h += k * DS * 0.5; x += Math.cos(h) * DS; y += Math.sin(h) * DS; h += k * DS * 0.5;
    }
    return { px, py, hd, kp, n };
  }

  /** Minimum gap between road parts that are not neighbours along the road (must exceed the corridor width). */
  function selfClearance(g, minGapSamples, cell) {
    const grid = new Map(), key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
    for (let i = 0; i < g.n; i++) { const k = key(Math.floor(g.px[i] / cell), Math.floor(g.py[i] / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    let best = Infinity;
    for (let i = 0; i < g.n; i += 2) {
      const cx = Math.floor(g.px[i] / cell), cy = Math.floor(g.py[i] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const arr = grid.get(key(cx + dx, cy + dy)); if (!arr) continue;
        for (const j of arr) { if (Math.abs(j - i) < minGapSamples) continue; const d = Math.hypot(g.px[i] - g.px[j], g.py[i] - g.py[j]); if (d < best) best = d; }
      }
    }
    return best;
  }

  /** Build a ready-to-use track object. Deterministic for a given definition. */
  function build(def) {
    if (typeof def === 'string') def = COURSES.find(c => c.id === def);
    const half = def.width / 2, shoulder = 1.6, EXTRA = def.extra == null ? 3.4 : def.extra;     // EXTRA: how much wider the OUTSIDE of a hairpin gets
    const railMaxEst = half + EXTRA + shoulder;
    const need = 2 * railMaxEst + 4;                          // clearance wanted between two stretches of road (centre to centre)
    let g = null, attempt = 0;
    for (; attempt < 400; attempt++) {
      const ks = buildCurvature(def, attempt, need); if (!ks) continue;
      g = integrate(ks);
      if (selfClearance(g, 90, 40) >= need) break;
      g = null;
    }
    if (!g) throw new Error('could not generate a clear course for ' + def.id);
    const n = g.n, px = g.px, py = g.py, hd = g.hd, kappa = g.kp;
    const s = new Float64Array(n); for (let i = 1; i < n; i++) s[i] = i * DS;      // (spacing is exactly DS by construction)
    const nx = new Float64Array(n), ny = new Float64Array(n);
    for (let i = 0; i < n; i++) { nx[i] = -Math.sin(hd[i]); ny[i] = Math.cos(hd[i]); }
    const length = (n - 1) * DS;
    const finishS = length - RUNOFF;
    // ---- road width per sample. The outside of a bend gets up to EXTRA metres more (a wide run-out for the slide), blended in
    //      smoothly over ~70 m before and after the bend so there are no pinch points or sudden steps. ----
    const hl = new Float64Array(n), hr = new Float64Array(n), railL = new Float64Array(n), railR = new Float64Array(n);
    {
      const W = 18, pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + kappa[i];
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - W), b = Math.min(n, i + W + 1), ks = (pre[b] - pre[a]) / (b - a);
        const f = Math.min(1, Math.abs(ks) * 38), e = EXTRA * f * f * (3 - 2 * f);
        hl[i] = half + (ks > 0 ? e : 0); hr[i] = half + (ks < 0 ? e : 0);
      }
      for (let pass = 0; pass < 2; pass++) for (const A of [hl, hr]) {          // two box-filter passes: the flare eases in and out over ~60 m, never a step
        const sm = new Float64Array(n); for (let i = 0; i < n; i++) { let t = 0, c = 0; for (let j = Math.max(0, i - 8); j <= Math.min(n - 1, i + 8); j++) { t += A[j]; c++; } sm[i] = t / c; }
        for (let i = 0; i < n; i++) A[i] = Math.max(half, sm[i]);
      }
      for (let i = 0; i < n; i++) { railL[i] = hl[i] + shoulder; railR[i] = hr[i] + shoulder; }
    }
    let railMax = 0; for (let i = 0; i < n; i++) railMax = Math.max(railMax, railL[i], railR[i]);
    const railOffset = railMax;
    const T = {
      id: def.id, def, name: def.name, region: def.region, tag: def.tag, look: def.look, width: def.width, half, shoulder, railOffset, railMax, extra: EXTRA, need, hl, hr, railL, railR,
      n, ds: DS, px, py, hd, kappa, s, nx, ny, length, startS: START_S, finishS, raceLength: finishS - START_S, attempt,
      checkpoints: [], driftZones: [], scenery: null, bounds: null,
    };
    // checkpoints: evenly spaced between the start and finish lines
    const ncp = Math.max(3, Math.round(T.raceLength / 520));
    for (let i = 1; i <= ncp; i++) T.checkpoints.push({ s: START_S + T.raceLength * i / (ncp + 1), idx: 0 });
    T.checkpoints.push({ s: finishS, idx: 0, finish: true });
    T.checkpoints.forEach(c => { c.idx = Math.round(c.s / DS); });
    findDriftZones(T);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, px[i]); y0 = Math.min(y0, py[i]); x1 = Math.max(x1, px[i]); y1 = Math.max(y1, py[i]); }
    T.bounds = { x0: x0 - 120, y0: y0 - 120, x1: x1 + 120, y1: y1 + 120 };

    /* ---- query: world point -> road coordinates. Reuses one result object (callers must copy what they keep). ---- */
    const res = { idx: 0, s: 0, offset: 0, nx: 0, ny: 0, hd: 0, dist: 0, surf: 1, onRoad: true, curv: 0, edge: 0, rail: 0, railL: 0, railR: 0 };
    function segDist(i, x, y) {
      const ax = px[i], ay = py[i], dx = px[i + 1] - ax, dy = py[i + 1] - ay;
      let u = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy); u = u < 0 ? 0 : u > 1 ? 1 : u;
      const cx = ax + dx * u - x, cy = ay + dy * u - y; return cx * cx + cy * cy;
    }
    T.query = function (x, y, hint) {
      let best = -1, bd = Infinity;
      if (hint != null && hint >= 0) {
        const lo = Math.max(0, hint - 14), hi = Math.min(n - 2, hint + 14);
        for (let i = lo; i <= hi; i++) { const d = segDist(i, x, y); if (d < bd) { bd = d; best = i; } }
      }
      if (best < 0 || bd > 14 * 14 || best === 0 || best === n - 2) {         // lost (reset / teleport / big jump): coarse global scan then refine
        let cb = 0, cd = Infinity;
        for (let i = 0; i < n - 1; i += 6) { const d = segDist(i, x, y); if (d < cd) { cd = d; cb = i; } }
        const lo = Math.max(0, cb - 8), hi = Math.min(n - 2, cb + 8); bd = Infinity;
        for (let i = lo; i <= hi; i++) { const d = segDist(i, x, y); if (d < bd) { bd = d; best = i; } }
      }
      const i = best, ax = px[i], ay = py[i], dx = px[i + 1] - ax, dy = py[i + 1] - ay, L2 = dx * dx + dy * dy;
      let u = ((x - ax) * dx + (y - ay) * dy) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const len = Math.sqrt(L2), tx = dx / len, ty = dy / len, rnx = -ty, rny = tx;
      const cx = ax + dx * u, cy = ay + dy * u;
      res.idx = i; res.s = (i + u) * DS; res.offset = (x - cx) * rnx + (y - cy) * rny; res.nx = rnx; res.ny = rny; res.hd = Math.atan2(ty, tx); res.dist = Math.sqrt(bd);
      const j = i + 1, hlq = hl[i] + (hl[j] - hl[i]) * u, hrq = hr[i] + (hr[j] - hr[i]) * u, rlq = railL[i] + (railL[j] - railL[i]) * u, rrq = railR[i] + (railR[j] - railR[i]) * u;
      const off = res.offset, eEdge = off >= 0 ? hrq : hlq, eRail = off >= 0 ? rrq : rlq, ao = Math.abs(off);
      res.edge = eEdge; res.rail = eRail; res.railL = rlq; res.railR = rrq;
      res.onRoad = ao <= eEdge; res.surf = ao <= eEdge ? 1 : ao <= eRail ? 0.66 : 0.5; res.curv = kappa[i];
      return res;
    };
    /** Road edges and rail positions at arc length sv: { hl, hr, railL, railR } (metres from the centre line, both positive). */
    T.edgeAt = function (sv) { const f = Math.max(0, Math.min(n - 1.001, sv / DS)), i = Math.floor(f), u = f - i, L = (A) => A[i] + (A[i + 1] - A[i]) * u; return { hl: L(hl), hr: L(hr), railL: L(railL), railR: L(railR) }; };
    /** Pose on the road at arc length s with lateral offset o: { x, y, th } facing along the road. */
    T.poseAt = function (sv, o) {
      const f = Math.max(0, Math.min(n - 1.001, sv / DS)), i = Math.floor(f), u = f - i;
      const x = px[i] + (px[i + 1] - px[i]) * u, y = py[i] + (py[i + 1] - py[i]) * u;
      let h0 = hd[i], h1 = hd[i + 1]; let dh = h1 - h0; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
      const th = h0 + dh * u, rnx = -Math.sin(th), rny = Math.cos(th);
      return { x: x + rnx * (o || 0), y: y + rny * (o || 0), th };
    };
    T.zoneAt = sv => { for (const z of T.driftZones) if (sv >= z.s0 && sv <= z.s1) return z; return null; };
    T.buildScenery = () => (T.scenery || (T.scenery = buildScenery(T)));
    return T;
  }

  /* ---------- drift zones: the tightest corners, each one flagged along its whole length ---------- */
  function findDriftZones(T) {
    const n = T.n, zones = [];
    let i = Math.round((T.startS + 60) / DS);
    while (i < Math.round(T.finishS / DS) - 10) {
      if (Math.abs(T.kappa[i]) > 1 / 120) {                  // inside a bend (radius < 120 m): long sweepers count, not just hairpins
        let j = i, peak = 0, turn = 0;
        while (j < n - 2 && Math.abs(T.kappa[j]) > 1 / 150 && Math.sign(T.kappa[j]) === Math.sign(T.kappa[i])) { peak = Math.max(peak, Math.abs(T.kappa[j])); turn += T.kappa[j] * DS; j++; }
        if (Math.abs(turn) > 0.6) zones.push({ s0: i * DS, s1: j * DS, peak, turn });
        i = j + 1;
      } else i++;
    }
    zones.sort((a, b) => (Math.abs(b.turn) + 8 * b.peak) - (Math.abs(a.turn) + 8 * a.peak));   // big arcs first (hairpins and long flowing corners)
    const want = Math.max(3, Math.round(T.raceLength / 330));
    T.driftZones = zones.slice(0, want).sort((a, b) => a.s0 - b.s0).map((z, k) => ({ id: k, s0: z.s0, s1: z.s1, peak: z.peak, turn: z.turn, dir: z.turn > 0 ? 1 : -1 }));
  }

  /* ---------- scenery (deterministic): trees, rocks, bushes and roadside posts, kept off the road ---------- */
  function buildScenery(T) {
    const R = rng(T.def.seed * 31 + 5), look = T.look, kind = look.kind, items = [], cell = 24, grid = new Map(), key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
    for (let i = 0; i < T.n; i += 2) { const k = key(Math.floor(T.px[i] / cell), Math.floor(T.py[i] / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    let nearest = 0;
    const roadDist = (x, y) => {                                // distance to the road minus the local rail position: < 0 means on / too near the road
      let best = Infinity; const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) { const a = grid.get(key(cx + dx, cy + dy)); if (a) for (const i of a) { const d = (x - T.px[i]) * (x - T.px[i]) + (y - T.py[i]) * (y - T.py[i]); if (d < best) { best = d; nearest = i; } } }
      return Math.sqrt(best) - Math.max(T.railL[nearest], T.railR[nearest]) - 1.2;
    };
    const clear = 2.2;
    const step = kind === 'canyon' ? 7 : 4.5 / Math.sqrt(look.density);
    for (let sv = 0; sv < T.length; sv += step * (0.6 + R() * 0.8)) {
      const p = T.poseAt(sv, 0), eg = T.edgeAt(sv);
      for (const side of [-1, 1]) {
        const tries = 1 + (R() < 0.6 ? 1 : 0);
        for (let t = 0; t < tries; t++) {
          const dist = (side < 0 ? eg.railL : eg.railR) + 2.7 + Math.pow(R(), 1.7) * 70, x = p.x - Math.sin(p.th) * dist * side, y = p.y + Math.cos(p.th) * dist * side;
          if (roadDist(x, y) < clear) continue;
          const roll = R(); let k = 0, r = 2.5 + R() * 2.5;
          if (kind === 'canyon') { k = roll < 0.45 ? 2 : roll < 0.7 ? 3 : 1; r = k === 2 ? 3 + R() * 7 : 1.6 + R() * 1.6; }
          else if (kind === 'mist') { k = roll < 0.4 ? 2 : roll < 0.65 ? 3 : 0; r = k === 2 ? 2 + R() * 4 : 2 + R() * 2.4; }
          else if (kind === 'crown') { k = roll < 0.3 ? 2 : roll < 0.45 ? 3 : roll < 0.7 ? 0 : 1; r = k === 2 ? 2.5 + R() * 5 : 2.4 + R() * 2.8; }
          else { k = roll < 0.78 ? 0 : roll < 0.9 ? 2 : 3; r = k === 2 ? 1.6 + R() * 3.4 : 2.6 + R() * 3; }
          items.push({ x, y, r, k, h: Math.floor(R() * 3), a: R() * 6.283 });
        }
      }
    }
    // spatial index (cells of 40 m) for drawing
    const gs = 40, idx = new Map();
    items.forEach((it, n) => { const kk = Math.floor(it.x / gs) * 100003 + Math.floor(it.y / gs); (idx.get(kk) || idx.set(kk, []).get(kk)).push(n); });
    // background lights for the summit city (Midnight Crown): scattered far from the road
    const lights = [];
    if (kind === 'crown') for (let q = 0; q < 700; q++) { const p = T.poseAt(R() * T.length, 0), dist = 90 + R() * 260, side = R() < 0.5 ? -1 : 1, x = p.x - Math.sin(p.th) * dist * side, y = p.y + Math.cos(p.th) * dist * side; if (roadDist(x, y) > 50) lights.push({ x, y, c: R() < 0.5 ? '#ffd9a0' : R() < 0.5 ? '#9fd0ff' : '#ff7ad9', r: 0.5 + R() * 1.2 }); }
    return { items, idx, gs, lights };
  }

  /** Unit-test helper: min distance between non-neighbouring road samples. */
  function clearance(T) { return selfClearance({ px: T.px, py: T.py, n: T.n }, 90, 40); }

  TD.Tracks = { COURSES, DS, build, rng, clearance, START_S, RUNOFF };
})();
