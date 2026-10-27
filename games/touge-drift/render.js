/* Touge Drift - rendering (Canvas 2D). Road geometry is pre-built per 80 m chunk (Path2D) and culled each frame; scenery
 * comes from the deterministic generator in tracks.js and is drawn through a spatial grid; particles, skid marks and
 * the HUD are bounded. World units are metres; the camera transform maps metres to pixels (optionally rotating). */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const TAU = Math.PI * 2;

  /* ---------- colour helpers ---------- */
  function hex(c) { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; }
  const rgb = (r, g, b, a) => a == null ? 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')' : 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')';
  function shade(c, k) { const [r, g, b] = hex(c); return k >= 0 ? rgb(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : rgb(r * (1 + k), g * (1 + k), b * (1 + k)); }
  function alpha(c, a) { const [r, g, b] = hex(c); return rgb(r, g, b, a); }

  /* ---------- car drawing (top-down), local frame: +x forward, metres ---------- */
  function bodyPath(ctx, L, W, nose, tail) {
    const a = L / 2, n = 2.9, N = 36; ctx.beginPath();
    for (let i = 0; i <= N * 2; i++) {
      const t = i / (N * 2) * TAU, c = Math.cos(t), s = Math.sin(t);
      const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), u = x / a;
      const f = u >= 0 ? 1 - nose * 0.42 * Math.pow(u, 2.4) : 1 - tail * 0.38 * Math.pow(-u, 2.4);
      const y = W / 2 * f * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  /** opts: { steer (rad), brake bool, lights bool, ghost bool, dmg 0..1 } */
  function drawCarTop(ctx, car, paint, wheelColor, opts) {
    opts = opts || {}; const L = car.len, W = car.wid, a = L / 2;
    if (opts.ghost) ctx.globalAlpha *= 0.42;
    // shadow
    ctx.save(); ctx.translate(0.25, 0.3); ctx.fillStyle = 'rgba(0,0,0,0.35)'; bodyPath(ctx, L * 1.02, W * 1.04, car.nose, car.tail); ctx.fill(); ctx.restore();
    // wheels (under the body)
    const wl = 0.66, ww = 0.3, fx = a * 0.62, rx = -a * 0.62, wy = W / 2 - 0.04;
    const wheel = (x, y, ang) => { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = '#0b0b0d'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-wl / 2, -ww / 2, wl, ww, 0.08) : ctx.rect(-wl / 2, -ww / 2, wl, ww); ctx.fill(); ctx.fillStyle = wheelColor || '#c9ccd2'; ctx.fillRect(-wl * 0.3, y > 0 ? ww / 2 - 0.06 : -ww / 2, wl * 0.6, 0.06); ctx.restore(); };
    wheel(fx, -wy, opts.steer || 0); wheel(fx, wy, opts.steer || 0); wheel(rx, -wy, 0); wheel(rx, wy, 0);
    // body
    const g = ctx.createLinearGradient(0, -W / 2, 0, W / 2); g.addColorStop(0, shade(paint, 0.3)); g.addColorStop(0.5, paint); g.addColorStop(1, shade(paint, -0.38));
    ctx.fillStyle = g; bodyPath(ctx, L, W, car.nose, car.tail); ctx.fill();
    ctx.strokeStyle = shade(paint, -0.55); ctx.lineWidth = 0.05; ctx.stroke();
    // hood creases + vents
    const hx0 = a * (1 - car.hood * 1.6), hx1 = a * 0.94;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(hx0, -W * 0.3); ctx.lineTo(hx1, -W * 0.2); ctx.moveTo(hx0, W * 0.3); ctx.lineTo(hx1, W * 0.2); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(hx0 + (hx1 - hx0) * 0.35, -W * 0.14, (hx1 - hx0) * 0.3, W * 0.28 * 0.25);
    // cabin (glass + roof)
    const c0 = -a + car.cab[0] * L, c1 = -a + car.cab[1] * L, cw = W * 0.74;
    ctx.fillStyle = '#15202c'; ctx.beginPath(); ctx.moveTo(c0, -cw * 0.46); ctx.lineTo(c1, -cw * 0.52); ctx.lineTo(c1 + 0.28, -cw * 0.34); ctx.lineTo(c1 + 0.28, cw * 0.34); ctx.lineTo(c1, cw * 0.52); ctx.lineTo(c0, cw * 0.46); ctx.lineTo(c0 - 0.2, cw * 0.36); ctx.lineTo(c0 - 0.2, -cw * 0.36); ctx.closePath(); ctx.fill();
    if (car.roof === 'open') {
      ctx.fillStyle = '#0d0f12'; ctx.fillRect(c0 + 0.05, -cw * 0.4, (c1 - c0) * 0.9, cw * 0.8);
      ctx.fillStyle = shade(paint, -0.5); ctx.fillRect(c0 + (c1 - c0) * 0.3, -cw * 0.34, 0.2, cw * 0.28); ctx.fillRect(c0 + (c1 - c0) * 0.3, cw * 0.06, 0.2, cw * 0.28);
    } else {
      const rg = ctx.createLinearGradient(0, -cw / 2, 0, cw / 2); rg.addColorStop(0, shade(paint, 0.22)); rg.addColorStop(1, shade(paint, -0.3));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(c0 + (c1 - c0) * 0.22, -cw * 0.42, (c1 - c0) * 0.56, cw * 0.84, 0.18) : ctx.rect(c0 + (c1 - c0) * 0.22, -cw * 0.42, (c1 - c0) * 0.56, cw * 0.84); ctx.fill();
    }
    // spoiler
    if (car.spoiler === 'wing') { ctx.fillStyle = '#101216'; ctx.fillRect(-a + 0.05, -W * 0.5, 0.52, W); ctx.fillStyle = shade(paint, -0.2); ctx.fillRect(-a + 0.12, -W * 0.52, 0.12, 0.2); ctx.fillRect(-a + 0.12, W * 0.52 - 0.2, 0.12, 0.2); }
    else if (car.spoiler === 'duck') { ctx.fillStyle = '#101216'; ctx.fillRect(-a + 0.02, -W * 0.4, 0.34, W * 0.8); }
    else if (car.spoiler === 'lip') { ctx.fillStyle = shade(paint, -0.45); ctx.fillRect(-a + 0.04, -W * 0.36, 0.14, W * 0.72); }
    // lights
    ctx.fillStyle = opts.lights === false ? '#a8a49a' : '#fff4cc'; ctx.fillRect(a - 0.34, -W * 0.42, 0.2, 0.3); ctx.fillRect(a - 0.34, W * 0.42 - 0.3, 0.2, 0.3);
    ctx.fillStyle = opts.brake ? '#ff2a1a' : '#7a1810'; ctx.fillRect(-a + 0.02, -W * 0.44, 0.14, 0.34); ctx.fillRect(-a + 0.02, W * 0.44 - 0.34, 0.14, 0.34);
    if (opts.brake) { ctx.fillStyle = 'rgba(255,40,20,0.35)'; ctx.beginPath(); ctx.arc(-a - 0.2, -W * 0.3, 0.7, 0, TAU); ctx.arc(-a - 0.2, W * 0.3, 0.7, 0, TAU); ctx.fill(); }
    if (opts.ghost) ctx.globalAlpha /= 0.42;
  }

  /* ---------- side view (garage) ---------- */
  function drawCarSide(ctx, car, paint, wheelStyle, wheelColor, px) {
    // px: pixels per metre. Car faces right, ground at y = 0.
    const L = car.len, H = car.roof === 'open' ? 1.12 : car.id === 'sora-hatch' ? 1.4 : car.drive === 'AWD' ? 1.38 : 1.25, s = px;
    const x0 = -L / 2, a = car.cab[0], b = car.cab[1], hood = car.hood, wr = 0.34, gc = 0.14;
    const X = f => (x0 + f * L) * s, Y = f => -(gc + f * H) * s;       // f in 0..1 of length / of height (above ground clearance)
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0.02 * s, L * 0.5 * s, 0.14 * s, 0, 0, TAU); ctx.fill();
    // body
    const g = ctx.createLinearGradient(0, Y(1), 0, Y(0)); g.addColorStop(0, shade(paint, 0.28)); g.addColorStop(0.55, paint); g.addColorStop(1, shade(paint, -0.42));
    ctx.fillStyle = g; ctx.strokeStyle = shade(paint, -0.6); ctx.lineWidth = Math.max(1, 0.03 * s);
    ctx.beginPath(); ctx.moveTo(X(0.0), Y(0.12));
    ctx.lineTo(X(0.0), Y(0.52)); ctx.quadraticCurveTo(X(0.0), Y(0.62), X(0.06), Y(0.64));                       // tail
    const roofOpen = car.roof === 'open', hatch = car.id === 'sora-hatch';
    if (roofOpen) { ctx.lineTo(X(a + 0.04), Y(0.66)); ctx.lineTo(X(b - 0.02), Y(0.7)); ctx.lineTo(X(b + 0.02), Y(0.84)); ctx.lineTo(X(b + 0.07), Y(0.84)); ctx.lineTo(X(b + 0.1), Y(0.7)); }
    else { ctx.lineTo(X(a - 0.02), Y(hatch ? 0.78 : 0.66)); ctx.quadraticCurveTo(X(a + 0.03), Y(1.0), X(a + 0.12), Y(1.0)); ctx.lineTo(X(b - 0.1), Y(1.0)); ctx.quadraticCurveTo(X(b - 0.02), Y(1.0), X(b + 0.04), Y(0.82)); ctx.lineTo(X(b + 0.07), Y(0.7)); }
    ctx.lineTo(X(1 - hood * 0.5), Y(0.62)); ctx.quadraticCurveTo(X(0.985), Y(0.58), X(1.0), Y(0.4)); ctx.lineTo(X(1.0), Y(0.14));
    ctx.lineTo(X(0.0), Y(0.12)); ctx.closePath(); ctx.fill(); ctx.stroke();
    // windows
    if (!roofOpen) { ctx.fillStyle = '#16212d'; ctx.beginPath(); ctx.moveTo(X(a + 0.0), Y(hatch ? 0.78 : 0.68)); ctx.quadraticCurveTo(X(a + 0.05), Y(0.94), X(a + 0.13), Y(0.94)); ctx.lineTo(X(b - 0.09), Y(0.94)); ctx.quadraticCurveTo(X(b - 0.03), Y(0.94), X(b + 0.015), Y(0.8)); ctx.lineTo(X(b + 0.04), Y(0.7)); ctx.lineTo(X(a + 0.0), Y(0.68)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = shade(paint, -0.5); ctx.beginPath(); ctx.moveTo(X((a + b) / 2), Y(0.94)); ctx.lineTo(X((a + b) / 2), Y(0.68)); ctx.stroke(); }
    else { ctx.fillStyle = '#16212d'; ctx.beginPath(); ctx.moveTo(X(b - 0.02), Y(0.7)); ctx.lineTo(X(b + 0.02), Y(0.83)); ctx.lineTo(X(b + 0.06), Y(0.83)); ctx.lineTo(X(b + 0.085), Y(0.7)); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(paint, -0.55); ctx.beginPath(); ctx.arc(X(a + (b - a) * 0.4), Y(0.78), 0.12 * s, 0, TAU); ctx.fill(); }
    // spoiler, lights, line
    if (car.spoiler === 'wing') { ctx.fillStyle = '#101216'; ctx.fillRect(X(0.0), Y(0.9), 0.5 * s, 0.07 * s); ctx.fillRect(X(0.035), Y(0.66), 0.06 * s, 0.26 * s); }
    else if (car.spoiler === 'duck') { ctx.fillStyle = '#101216'; ctx.fillRect(X(0.0), Y(0.7), 0.32 * s, 0.06 * s); }
    else if (car.spoiler === 'lip') { ctx.fillStyle = shade(paint, -0.5); ctx.fillRect(X(0.0), Y(0.66), 0.2 * s, 0.04 * s); }
    ctx.fillStyle = '#fff4cc'; ctx.fillRect(X(0.965), Y(0.5), 0.22 * s, 0.1 * s); ctx.fillStyle = '#ff2a1a'; ctx.fillRect(X(0.0), Y(0.55), 0.14 * s, 0.1 * s);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(1, 0.02 * s); ctx.beginPath(); ctx.moveTo(X(0.04), Y(0.4)); ctx.lineTo(X(0.97), Y(0.4)); ctx.stroke();
    // wheels
    for (const wx of [0.2, 0.795]) drawWheelSide(ctx, X(wx), -wr * s, wr * s, wheelStyle, wheelColor);
    ctx.restore();
  }
  function drawWheelSide(ctx, cx, cy, r, style, color) {
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = '#0c0c0e'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1a1e'; ctx.beginPath(); ctx.arc(0, 0, r * 0.84, 0, TAU); ctx.fill();
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, r * 0.07);
    const ri = r * 0.74;
    if (style === 'five') { ctx.beginPath(); ctx.arc(0, 0, ri, 0, TAU); ctx.lineWidth = r * 0.07; ctx.stroke(); ctx.fillStyle = '#16161a'; for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + 0.3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, ri * 0.95, a + 0.28, a + (TAU / 5) - 0.28); ctx.closePath(); ctx.fill(); } ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, ri * 0.22, 0, TAU); ctx.fill(); ctx.lineWidth = r * 0.13; for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + 0.3 + TAU / 10; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * ri, Math.sin(a) * ri); ctx.stroke(); } }
    else if (style === 'mesh') { ctx.beginPath(); ctx.arc(0, 0, ri, 0, TAU); ctx.fill(); ctx.strokeStyle = '#16161a'; ctx.lineWidth = r * 0.05; for (let i = -4; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(i * ri / 4, -ri); ctx.lineTo(i * ri / 4 + ri * 0.9, ri); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i * ri / 4, ri); ctx.lineTo(i * ri / 4 + ri * 0.9, -ri); ctx.stroke(); } ctx.globalCompositeOperation = 'destination-over'; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#0c0c0e'; ctx.beginPath(); ctx.arc(0, 0, ri + r * 0.18, 0, TAU); ctx.arc(0, 0, ri, 0, TAU, true); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, ri * 0.2, 0, TAU); ctx.fill(); }
    else if (style === 'turbine') { ctx.beginPath(); ctx.arc(0, 0, ri, 0, TAU); ctx.lineWidth = r * 0.06; ctx.stroke(); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * ri * 0.2, Math.sin(a) * ri * 0.2); ctx.quadraticCurveTo(Math.cos(a + 0.5) * ri * 0.6, Math.sin(a + 0.5) * ri * 0.6, Math.cos(a + 0.25) * ri, Math.sin(a + 0.25) * ri); ctx.lineWidth = r * 0.07; ctx.stroke(); } ctx.beginPath(); ctx.arc(0, 0, ri * 0.16, 0, TAU); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(0, 0, ri, 0, TAU); ctx.fill(); ctx.fillStyle = shade(color, -0.35); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * ri * 0.55, Math.sin(a) * ri * 0.55, ri * 0.13, 0, TAU); ctx.fill(); } ctx.beginPath(); ctx.arc(0, 0, ri * 0.16, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  /* ---------- effects: particles + skid marks, all bounded ---------- */
  function createFx() {
    const MAXP = 420, MAXS = 1500;
    const P = [], S = []; let sIdx = 0;
    const last = {};
    return {
      P, S,
      smoke(x, y, vx, vy, r0, color, life, a0) { if (P.length >= MAXP) P.shift(); P.push({ x, y, vx, vy, r: r0, r0, c: color, t: 0, life, a0: a0 == null ? 0.5 : a0, k: 0 }); },
      spark(x, y, vx, vy) { if (P.length >= MAXP) P.shift(); P.push({ x, y, vx, vy, r: 0.07, r0: 0.07, c: '#ffc060', t: 0, life: 0.35 + Math.random() * 0.25, a0: 1, k: 1 }); },
      skid(key, x, y, a) {                                                  // continue a mark for a wheel (key) from its last position
        const l = last[key];
        if (a > 0.08 && l && Math.hypot(x - l.x, y - l.y) < 3) { const seg = { x1: l.x, y1: l.y, x2: x, y2: y, a: Math.min(0.6, a) }; if (S.length < MAXS) S.push(seg); else { S[sIdx] = seg; sIdx = (sIdx + 1) % MAXS; } }
        last[key] = a > 0.08 ? { x, y } : null;
      },
      clear() { P.length = 0; S.length = 0; sIdx = 0; for (const k in last) last[k] = null; },
      update(dt) { for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; p.t += dt; if (p.t >= p.life) { P.splice(i, 1); continue; } const u = p.t / p.life; p.x += p.vx * dt; p.y += p.vy * dt; if (!p.k) { p.vx *= 1 - dt * 1.4; p.vy *= 1 - dt * 1.4; p.r = p.r0 * (1 + u * 3.2); } } },
      drawMarks(ctx, view) {
        ctx.lineCap = 'round'; ctx.lineWidth = 0.26;
        for (let i = 0; i < S.length; i++) { const s = S[i]; if (s.x1 < view.x0 || s.x1 > view.x1 || s.y1 < view.y0 || s.y1 > view.y1) continue; ctx.strokeStyle = 'rgba(6,6,8,' + s.a + ')'; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); }
      },
      drawParticles(ctx) {
        for (let i = 0; i < P.length; i++) { const p = P[i], u = p.t / p.life; if (p.k) { ctx.fillStyle = 'rgba(255,190,90,' + (1 - u) + ')'; ctx.fillRect(p.x - 0.05, p.y - 0.05, 0.1, 0.1); } else { ctx.fillStyle = alpha(p.c, p.a0 * (1 - u) * (1 - u)); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); } }
      },
    };
  }

  /* ---------- the renderer ---------- */
  function create(canvas) {
    const ctx = canvas.getContext('2d');
    const R = { canvas, ctx, W: 0, H: 0, dpr: 1, track: null, chunks: [], ground: null, mini: null, noise: null };

    R.resize = function () {
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2), w = canvas.clientWidth || globalThis.innerWidth, h = canvas.clientHeight || globalThis.innerHeight;
      canvas.width = Math.max(2, Math.round(w * dpr)); canvas.height = Math.max(2, Math.round(h * dpr)); R.W = w; R.H = h; R.dpr = dpr;
    };

    function makeNoise(look) {
      const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), rn = TD.Tracks.rng(7);
      g.fillStyle = look.ground; g.fillRect(0, 0, 256, 256);
      const wrap = (fn) => { for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) fn(dx, dy); };   // draw each blob at wrapped offsets so the tile has no seams
      for (let i = 0; i < 90; i++) { const x = rn() * 256, y = rn() * 256, rx = 8 + rn() * 26, ry = 6 + rn() * 18, a = rn() * 3, col = i % 3 ? look.ground2 : shade(look.ground, -0.18), al = 0.1 + rn() * 0.16; wrap((dx, dy) => { g.fillStyle = alpha(col, al); g.beginPath(); g.ellipse(x + dx, y + dy, rx, ry, a, 0, TAU); g.fill(); }); }
      for (let i = 0; i < 500; i++) { const x = rn() * 256, y = rn() * 256, w = 1 + rn() * 2.4, col = rn() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)'; wrap((dx, dy) => { g.fillStyle = col; g.fillRect(x + dx, y + dy, w, w); }); }
      return c;
    }

    R.setTrack = function (track) {
      R.track = track; const look = track.look; R.noise = makeNoise(look); R.ground = ctx.createPattern(R.noise, 'repeat');
      if (R.ground && R.ground.setTransform && typeof DOMMatrix !== 'undefined') R.ground.setTransform(new DOMMatrix().scale(1 / 8));      // 256 px = 32 m
      R.chunks = buildChunks(track); R.mini = buildMini(track); track.buildScenery();
    };

    const CH = 40;
    function buildChunks(T) {
      const out = [], half = T.half, sh = T.railOffset, look = T.look;
      for (let a = 0; a < T.n - 1; a += CH) {
        const b = Math.min(T.n - 1, a + CH), c = { a, b, road: new Path2D(), shoulder: new Path2D(), edgeL: new Path2D(), edgeR: new Path2D(), center: new Path2D(), rails: new Path2D(), posts: new Path2D(), cliff: new Path2D(), zone: new Path2D(), signs: new Path2D(), refl: new Path2D(), x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
        const side = (path, o0, o1) => { for (let i = a; i <= b; i++) { const x = T.px[i] + T.nx[i] * o1, y = T.py[i] + T.ny[i] * o1; if (i === a) path.moveTo(x, y); else path.lineTo(x, y); } for (let i = b; i >= a; i--) path.lineTo(T.px[i] + T.nx[i] * o0, T.py[i] + T.ny[i] * o0); path.closePath(); };
        const line = (path, o) => { for (let i = a; i <= b; i++) { const x = T.px[i] + T.nx[i] * o, y = T.py[i] + T.ny[i] * o; if (i === a) path.moveTo(x, y); else path.lineTo(x, y); } };
        side(c.shoulder, -sh - 0.1, sh + 0.1); side(c.road, -half, half);
        line(c.edgeL, -half + 0.4); line(c.edgeR, half - 0.4); line(c.center, 0); line(c.rails, -sh); c.rails.moveTo(T.px[a] + T.nx[a] * sh, T.py[a] + T.ny[a] * sh); line(c.rails, sh);
        side(c.cliff, sh + 0.2, sh + 7); side(c.cliff, -sh - 7, -sh - 0.2);
        for (let i = a; i <= b; i += 2) for (const sd of [-1, 1]) { const o = sd * sh, x = T.px[i] + T.nx[i] * o, y = T.py[i] + T.ny[i] * o; c.posts.rect(x - 0.16, y - 0.16, 0.32, 0.32); }
        for (let i = a; i <= b; i += 10) for (const sd of [-1, 1]) { const o = sd * (sh + 0.1), x = T.px[i] + T.nx[i] * o, y = T.py[i] + T.ny[i] * o; c.refl.rect(x - 0.12, y - 0.12, 0.24, 0.24); }
        // drift zones: amber bands along the inner edges
        for (const z of T.driftZones) { const za = Math.max(a, Math.round(z.s0 / T.ds)), zb = Math.min(b, Math.round(z.s1 / T.ds)); if (zb <= za) continue;
          for (const o of [-half + 1.0, half - 1.0]) { for (let i = za; i <= zb; i++) { const x = T.px[i] + T.nx[i] * o, y = T.py[i] + T.ny[i] * o; if (i === za) c.zone.moveTo(x, y); else c.zone.lineTo(x, y); } } }
        // chevron signs on the outside of tight bends
        for (let i = a; i <= b; i += 4) { const k = T.kappa[i]; if (Math.abs(k) > 1 / 48) { const sd = k > 0 ? -1 : 1, o = sd * (sh + 1.4), x = T.px[i] + T.nx[i] * o, y = T.py[i] + T.ny[i] * o; c.signs.rect(x - 0.45, y - 0.45, 0.9, 0.9); } }
        for (let i = a; i <= b; i += 8) { c.x0 = Math.min(c.x0, T.px[i] - sh - 9); c.x1 = Math.max(c.x1, T.px[i] + sh + 9); c.y0 = Math.min(c.y0, T.py[i] - sh - 9); c.y1 = Math.max(c.y1, T.py[i] + sh + 9); }
        out.push(c);
      }
      return out;
    }

    function buildMini(T) {
      const S = 190, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), b = T.bounds, sc = Math.min((S - 16) / (b.x1 - b.x0), (S - 16) / (b.y1 - b.y0)), ox = (S - (b.x1 - b.x0) * sc) / 2, oy = (S - (b.y1 - b.y0) * sc) / 2;
      const m = { c, sc, ox, oy, b };
      g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 5; g.beginPath(); for (let i = 0; i < T.n; i += 3) { const x = (T.px[i] - b.x0) * sc + ox, y = (T.py[i] - b.y0) * sc + oy; if (!i) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke();
      g.strokeStyle = '#e9e4d6'; g.lineWidth = 2.2; g.stroke();
      g.strokeStyle = '#f2a53a'; g.lineWidth = 3.4; for (const z of T.driftZones) { g.beginPath(); for (let i = Math.round(z.s0 / T.ds); i <= Math.round(z.s1 / T.ds); i++) { const x = (T.px[i] - b.x0) * sc + ox, y = (T.py[i] - b.y0) * sc + oy; if (i === Math.round(z.s0 / T.ds)) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
      return m;
    }

    /* world draw. view: { cam:{x,y,rot,zoom}, race, fx, settings, now, drawCars:true } */
    R.drawWorld = function (view) {
      const T = R.track, W = R.W, H = R.H, cam = view.cam, look = T.look, z = cam.zoom * Math.min(W, H) / 62;
      ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
      ctx.fillStyle = look.ground; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H * (cam.anchor == null ? 0.58 : cam.anchor)); ctx.rotate(cam.rot); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
      const rad = Math.hypot(W, H) / 2 / z + 14, vx0 = cam.x - rad, vx1 = cam.x + rad, vy0 = cam.y - rad, vy1 = cam.y + rad, vb = { x0: vx0, x1: vx1, y0: vy0, y1: vy1 };
      // ground
      if (R.ground) { ctx.fillStyle = R.ground; ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0); }
      // cliffs + shoulder + road
      const vis = R.chunks.filter(c => c.x1 >= vx0 && c.x0 <= vx1 && c.y1 >= vy0 && c.y0 <= vy1);
      ctx.fillStyle = 'rgba(0,0,0,0.24)'; for (const c of vis) ctx.fill(c.cliff);
      ctx.fillStyle = look.shoulder; for (const c of vis) ctx.fill(c.shoulder);
      ctx.fillStyle = look.road; for (const c of vis) ctx.fill(c.road);
      // surface wear: darker racing line texture
      ctx.strokeStyle = alpha(shade(look.road, -0.3), 0.35); ctx.lineWidth = 1.6; for (const c of vis) ctx.stroke(c.center);
      ctx.setLineDash([]); ctx.strokeStyle = look.line; ctx.lineWidth = 0.2; for (const c of vis) { ctx.stroke(c.edgeL); ctx.stroke(c.edgeR); }
      ctx.setLineDash([3, 5]); ctx.lineWidth = 0.18; ctx.strokeStyle = alpha(look.line, 0.85); for (const c of vis) ctx.stroke(c.center); ctx.setLineDash([]);
      // drift zones
      ctx.strokeStyle = 'rgba(242,165,58,0.75)'; ctx.lineWidth = 0.55; for (const c of vis) ctx.stroke(c.zone);
      // skid marks
      if (view.fx) view.fx.drawMarks(ctx, vb);
      // start / finish / checkpoint gates
      drawGates(T, vb, view);
      // rails
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.8; ctx.save(); ctx.translate(0.3, 0.35); for (const c of vis) ctx.stroke(c.rails); ctx.restore();
      ctx.strokeStyle = look.rail; ctx.lineWidth = 0.34; for (const c of vis) ctx.stroke(c.rails);
      ctx.fillStyle = shade(look.rail, -0.35); for (const c of vis) ctx.fill(c.posts);
      ctx.fillStyle = '#ff5a3a'; for (const c of vis) ctx.fill(c.refl);
      ctx.fillStyle = '#f2c230'; for (const c of vis) ctx.fill(c.signs);
      // cars
      if (view.race) drawRacers(view, z);
      // particles
      if (view.fx) view.fx.drawParticles(ctx);
      // scenery on top (trees overhang nothing, but give depth)
      drawScenery(T, vb, view);
      ctx.restore();
      // atmosphere
      atmosphere(view, z);
    };

    function drawGates(T, vb, view) {
      const half = T.half + 0.3;
      const gate = (s, color, checker, w) => {
        const p = T.poseAt(s, 0); if (p.x < vb.x0 - 8 || p.x > vb.x1 + 8 || p.y < vb.y0 - 8 || p.y > vb.y1 + 8) return;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.th);
        if (checker) { const n = 14, cw = (half * 2) / n; for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) { ctx.fillStyle = (i + j) % 2 ? '#101010' : '#f4f4f4'; ctx.fillRect(j * 0.7 - 1, -half + i * cw, 0.7, cw); } }
        else { ctx.fillStyle = color; ctx.globalAlpha = 0.55; ctx.fillRect(-0.3, -half, 0.6, half * 2); ctx.globalAlpha = 1; }
        // gate posts + banner pillars on the rails
        ctx.fillStyle = '#d9d4c4'; ctx.fillRect(-0.5, -T.railOffset - 0.4, 1, 0.8); ctx.fillRect(-0.5, T.railOffset - 0.4, 1, 0.8);
        ctx.restore();
      };
      gate(T.startS, '#7be07b', true); const last = T.checkpoints.length - 1;
      T.checkpoints.forEach((c, i) => { if (i === last) gate(c.s, '#fff', true); else { const done = view.race && view.race.player.nextCp > i; gate(c.s, done ? '#6bd16b' : '#f2a53a', false); } });
    }

    function drawRacers(view, z) {
      const race = view.race, V = TD.Vehicles;
      // ghost
      if (race.ghost && race.state === 'running') { const gp = TD.Race.ghostPose(race, race.t); if (gp) { const car = V.carById(race.ghost.carId) || V.CARS[0]; ctx.save(); ctx.translate(gp.x, gp.y); ctx.rotate(gp.th); drawCarTop(ctx, car, '#9fd0ff', '#c9ccd2', { ghost: true, lights: false }); ctx.restore(); } }
      const order = race.racers.slice().sort((a, b) => (a.human ? 1 : 0) - (b.human ? 1 : 0));
      for (const rc of order) {
        const c = rc.c; ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.th);
        const b = rc.def && rc.def.build; drawCarTop(ctx, rc.car, rc.color, V.WHEEL_COLORS[(b && b.wheelColor) || 0], { steer: c.steerAngle, brake: (c.brk || 0) > 0.2 || (c.vx > 1 && c.thr === 0 && false) });
        ctx.restore();
        if (!rc.human) { ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(-view.cam.rot); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.font = '600 ' + (11 / z) + 'px system-ui'; ctx.textAlign = 'center'; const tw = ctx.measureText(rc.name).width; ctx.fillRect(-tw / 2 - 3 / z, -3.9 - 11 / z, tw + 6 / z, 14 / z); ctx.fillStyle = '#fff'; ctx.fillText(rc.name, 0, -3.9); ctx.restore(); }
      }
    }

    const KIND = { pine: 0, broad: 1, rock: 2, bush: 3 };
    function drawScenery(T, vb, view) {
      const sc = T.scenery; if (!sc) return; const look = T.look, gs = sc.gs, kind = look.kind;
      const cx0 = Math.floor(vb.x0 / gs), cx1 = Math.floor(vb.x1 / gs), cy0 = Math.floor(vb.y0 / gs), cy1 = Math.floor(vb.y1 / gs), low = view.settings && view.settings.particles === 'low';
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const arr = sc.idx.get(cx * 100003 + cy); if (!arr) continue;
        for (let q = 0; q < arr.length; q++) {
          const it = sc.items[arr[q]], r = it.r;
          if (it.k === 0) {                              // conifer from above: layered star
            const col = look.tree[it.h % look.tree.length];
            ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.beginPath(); ctx.arc(it.x + r * 0.35, it.y + r * 0.45, r * 1.02, 0, TAU); ctx.fill();
            ctx.fillStyle = col; star(it.x, it.y, r, r * 0.55, 9, it.a); ctx.fill();
            if (!low) { ctx.fillStyle = shade(col, 0.18); star(it.x - r * 0.08, it.y - r * 0.1, r * 0.62, r * 0.34, 9, it.a + 0.2); ctx.fill(); ctx.fillStyle = shade(col, 0.34); ctx.beginPath(); ctx.arc(it.x - r * 0.1, it.y - r * 0.12, r * 0.16, 0, TAU); ctx.fill(); }
          } else if (it.k === 1) {                        // broadleaf: cluster of lobes
            const col = look.tree[(it.h + 1) % look.tree.length];
            ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.arc(it.x + r * 0.35, it.y + r * 0.45, r * 1.05, 0, TAU); ctx.fill();
            ctx.fillStyle = shade(col, -0.18); for (let b = 0; b < 6; b++) { const a = it.a + b * 1.05; ctx.beginPath(); ctx.arc(it.x + Math.cos(a) * r * 0.5, it.y + Math.sin(a) * r * 0.5, r * 0.55, 0, TAU); ctx.fill(); }
            ctx.fillStyle = col; for (let b = 0; b < 5; b++) { const a = it.a + 0.5 + b * 1.25; ctx.beginPath(); ctx.arc(it.x + Math.cos(a) * r * 0.32, it.y + Math.sin(a) * r * 0.32, r * 0.42, 0, TAU); ctx.fill(); }
            if (!low) { ctx.fillStyle = shade(col, 0.22); for (let b = 0; b < 3; b++) { const a = it.a + b * 2.1; ctx.beginPath(); ctx.arc(it.x - r * 0.12 + Math.cos(a) * r * 0.2, it.y - r * 0.16 + Math.sin(a) * r * 0.2, r * 0.2, 0, TAU); ctx.fill(); } }
          } else if (it.k === 2) {                        // rock
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; blob(it.x + r * 0.2, it.y + r * 0.3, r * 1.05, 7, it.a); ctx.fill();
            ctx.fillStyle = look.rock; blob(it.x, it.y, r, 7, it.a); ctx.fill();
            ctx.fillStyle = shade(look.rock, 0.22); blob(it.x - r * 0.18, it.y - r * 0.22, r * 0.55, 6, it.a + 1); ctx.fill();
            if (kind === 'canyon' && r > 5) { ctx.strokeStyle = shade(look.rock, -0.3); ctx.lineWidth = 0.18; ctx.beginPath(); ctx.moveTo(it.x - r * 0.6, it.y + r * 0.1); ctx.lineTo(it.x + r * 0.5, it.y - r * 0.2); ctx.moveTo(it.x - r * 0.4, it.y + r * 0.5); ctx.lineTo(it.x + r * 0.6, it.y + r * 0.25); ctx.stroke(); }
          } else {                                         // bush: a few lobes
            const col = look.tree[it.h % look.tree.length];
            ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(it.x + r * 0.25, it.y + r * 0.3, r * 0.95, 0, TAU); ctx.fill();
            ctx.fillStyle = shade(col, -0.05); for (let b = 0; b < 4; b++) { const a = it.a + b * 1.6; ctx.beginPath(); ctx.arc(it.x + Math.cos(a) * r * 0.42, it.y + Math.sin(a) * r * 0.42, r * 0.5, 0, TAU); ctx.fill(); }
            ctx.fillStyle = shade(col, 0.2); ctx.beginPath(); ctx.arc(it.x - r * 0.12, it.y - r * 0.15, r * 0.3, 0, TAU); ctx.fill();
          }
        }
      }
      if (sc.lights.length) for (const l of sc.lights) { if (l.x < vb.x0 || l.x > vb.x1 || l.y < vb.y0 || l.y > vb.y1) continue; ctx.fillStyle = l.c; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, TAU); ctx.fill(); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 3.2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    }
    function star(x, y, ro, ri, n, rot) { ctx.beginPath(); for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, r = i % 2 ? ri : ro; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); }
    function blob(x, y, r, n, rot) { ctx.beginPath(); for (let i = 0; i < n; i++) { const a = rot + i / n * TAU, rr = r * (0.8 + 0.2 * Math.sin(i * 2.7 + rot * 3)); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); }

    /* darkness, headlights, fog, vignette (screen space) */
    function atmosphere(view, z) {
      const T = R.track, look = T.look, W = R.W, H = R.H, cam = view.cam;
      const dark = look.dark, sky = look.sky;
      ctx.fillStyle = alpha(shade(sky, -0.82), dark); ctx.fillRect(0, 0, W, H);
      if (view.race) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        ctx.translate(W / 2, H * (cam.anchor == null ? 0.58 : cam.anchor)); ctx.rotate(cam.rot); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
        for (const rc of view.race.racers) {
          const c = rc.c, x = c.x + Math.cos(c.th) * 2, y = c.y + Math.sin(c.th) * 2;
          const g = ctx.createRadialGradient(x + Math.cos(c.th) * 8, y + Math.sin(c.th) * 8, 1, x + Math.cos(c.th) * 11, y + Math.sin(c.th) * 11, 20);
          g.addColorStop(0, 'rgba(255,238,190,' + (0.38 * (0.35 + dark)) + ')'); g.addColorStop(1, 'rgba(255,238,190,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, y - 0.6); ctx.lineTo(x + Math.cos(c.th - 0.34) * 30, y + Math.sin(c.th - 0.34) * 30); ctx.lineTo(x + Math.cos(c.th + 0.34) * 30, y + Math.sin(c.th + 0.34) * 30); ctx.lineTo(x, y + 0.6); ctx.fill();
          ctx.fillStyle = 'rgba(255,60,30,' + (0.14 + 0.12 * (rc.c.brk || 0)) + ')'; ctx.beginPath(); ctx.arc(c.x - Math.cos(c.th) * 2.2, c.y - Math.sin(c.th) * 2.2, 2.6, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
      if (look.fog > 0.05) { const g = ctx.createRadialGradient(W / 2, H * 0.58, Math.min(W, H) * 0.12, W / 2, H * 0.58, Math.max(W, H) * 0.7); g.addColorStop(0, alpha(sky, 0)); g.addColorStop(1, alpha(sky, look.fog * 1.5)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.fillStyle = alpha(sky, look.fog * 0.28); ctx.fillRect(0, 0, W, H); }
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }

    /* ---------- HUD ---------- */
    const mono = '600 {s}px ui-monospace, "SF Mono", Menlo, Consolas, monospace', sans = '800 {s}px "Avenir Next Condensed", "Arial Narrow", system-ui, sans-serif';
    const font = (t, s) => t.replace('{s}', s);
    const fmt = t => { if (t == null || !isFinite(t)) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3); };
    R.fmtTime = fmt;

    R.drawHUD = function (h) {
      const W = R.W, H = R.H, g = ctx, amber = '#f2a53a', u = Math.max(0.72, Math.min(1.35, Math.min(W, H) / 760));
      g.setTransform(R.dpr, 0, 0, R.dpr, 0, 0); g.textBaseline = 'alphabetic';
      const pad = 18 * u;
      // top-left: time + mode
      g.fillStyle = 'rgba(8,9,12,0.62)'; rr(pad, pad, 210 * u, 74 * u, 12 * u); g.fill();
      g.fillStyle = '#9aa0ab'; g.font = font(mono, 11 * u); g.textAlign = 'left'; g.fillText(h.label, pad + 14 * u, pad + 22 * u);
      g.fillStyle = '#f4f1e8'; g.font = font(mono, 28 * u); g.fillText(fmt(h.time), pad + 14 * u, pad + 54 * u);
      if (h.penalty) { g.fillStyle = '#ff7a5a'; g.font = font(mono, 11 * u); g.fillText('+' + h.penalty.toFixed(0) + 's reset', pad + 14 * u, pad + 68 * u); }
      // checkpoint / progress
      g.fillStyle = 'rgba(8,9,12,0.62)'; rr(pad, pad + 84 * u, 210 * u, 30 * u, 10 * u); g.fill();
      g.fillStyle = '#d9d4c4'; g.font = font(mono, 12 * u); g.fillText('CP ' + h.cp + ' / ' + h.cpTotal, pad + 14 * u, pad + 104 * u);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(pad + 84 * u, pad + 96 * u, 112 * u, 5 * u); g.fillStyle = amber; g.fillRect(pad + 84 * u, pad + 96 * u, 112 * u * clamp(h.progress, 0, 1), 5 * u);
      if (h.best != null) { g.fillStyle = '#9aa0ab'; g.font = font(mono, 11 * u); g.fillText('BEST ' + fmt(h.best), pad, pad + 132 * u); }
      if (h.place) { g.fillStyle = 'rgba(8,9,12,0.62)'; rr(pad, pad + 140 * u, 92 * u, 44 * u, 10 * u); g.fill(); g.fillStyle = amber; g.font = font(sans, 30 * u); g.fillText(h.place + '/' + h.field, pad + 12 * u, pad + 172 * u); g.fillStyle = '#9aa0ab'; g.font = font(mono, 10 * u); g.fillText('POSITION', pad + 56 * u, pad + 160 * u); }
      // minimap
      if (R.mini) { const m = R.mini, S = 160 * u, mx = W - pad - S, my = pad; g.fillStyle = 'rgba(8,9,12,0.62)'; rr(mx, my, S, S, 14 * u); g.fill(); g.drawImage(m.c, mx + 4, my + 4, S - 8, S - 8); const k = (S - 8) / m.c.width;
        for (const d of h.dots) { g.fillStyle = d.me ? '#ffffff' : d.color; g.beginPath(); g.arc(mx + 4 + ((d.x - m.b.x0) * m.sc + m.ox) * k, my + 4 + ((d.y - m.b.y0) * m.sc + m.oy) * k, (d.me ? 4.2 : 3.2) * u, 0, TAU); g.fill(); if (d.me) { g.strokeStyle = amber; g.lineWidth = 1.5; g.stroke(); } } }
      // speedometer (bottom right)
      const sx = W - pad - 92 * u, sy = H - pad - 92 * u, r = 82 * u, a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, maxS = h.units === 'mph' ? 200 : 320;
      g.fillStyle = 'rgba(8,9,12,0.66)'; g.beginPath(); g.arc(sx, sy, r + 8 * u, 0, TAU); g.fill();
      g.lineCap = 'round'; g.lineWidth = 7 * u; g.strokeStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(sx, sy, r - 6 * u, a0, a1); g.stroke();
      const sp = clamp(h.speed / maxS, 0, 1); g.strokeStyle = amber; g.beginPath(); g.arc(sx, sy, r - 6 * u, a0, a0 + (a1 - a0) * sp); g.stroke();
      const rp = clamp(h.rpm, 0, 1); g.lineWidth = 4 * u; g.strokeStyle = rp > 0.88 ? '#ff4a3a' : '#6fc3ff'; g.beginPath(); g.arc(sx, sy, r - 16 * u, a0, a0 + (a1 - a0) * rp); g.stroke();
      g.textAlign = 'center'; g.fillStyle = '#f4f1e8'; g.font = font(sans, 44 * u); g.fillText(String(Math.round(h.speed)), sx, sy + 10 * u); g.fillStyle = '#9aa0ab'; g.font = font(mono, 11 * u); g.fillText(h.units === 'mph' ? 'MPH' : 'KM/H', sx, sy + 28 * u);
      g.fillStyle = amber; g.font = font(sans, 22 * u); g.fillText(h.gear > 0 ? String(h.gear) : 'R', sx, sy - 32 * u);
      // drift panel
      if (h.drift && (h.mode === 'drift' || h.drift.active || h.drift.score > 0)) {
        const d = h.drift, cx = W / 2, y0 = pad;
        g.fillStyle = 'rgba(8,9,12,0.62)'; rr(cx - 150 * u, y0, 300 * u, 78 * u, 14 * u); g.fill();
        g.textAlign = 'center'; g.fillStyle = '#9aa0ab'; g.font = font(mono, 11 * u); g.fillText(h.mode === 'drift' ? 'DRIFT SCORE' : 'DRIFT', cx, y0 + 20 * u);
        g.fillStyle = '#f4f1e8'; g.font = font(sans, 34 * u); g.fillText(Math.round(d.score + d.chain).toLocaleString('en-US'), cx, y0 + 52 * u);
        if (d.active) { g.fillStyle = amber; g.font = font(mono, 14 * u); g.fillText('+' + Math.round(d.chain) + '  ×' + d.combo.toFixed(1) + (d.zone ? '  ZONE ×2' : '') + '   ' + Math.round(Math.abs(d.angle) * 57.3) + '°', cx, y0 + 70 * u); }
        else if (d.bankMsg) { g.fillStyle = '#7be07b'; g.font = font(mono, 14 * u); g.fillText(d.bankMsg, cx, y0 + 70 * u); }
        else if (d.lostMsg) { g.fillStyle = '#ff7a5a'; g.font = font(mono, 14 * u); g.fillText(d.lostMsg, cx, y0 + 70 * u); }
      }
      // centre messages
      g.textAlign = 'center';
      if (h.count != null) { g.fillStyle = h.count === 0 ? '#7be07b' : '#f4f1e8'; g.font = font(sans, (h.count === 0 ? 120 : 140) * u); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 20; g.fillText(h.count === 0 ? 'GO' : String(h.count), W / 2, H * 0.38); g.shadowBlur = 0; }
      if (h.banner) { g.font = font(sans, 30 * u); const tw = g.measureText(h.banner.text).width; g.globalAlpha = clamp(h.banner.t * 2, 0, 1); g.fillStyle = 'rgba(8,9,12,0.7)'; rr(W / 2 - tw / 2 - 20 * u, H * 0.2 - 28 * u, tw + 40 * u, 44 * u, 12 * u); g.fill(); g.fillStyle = h.banner.color || amber; g.fillText(h.banner.text, W / 2, H * 0.2 + 4 * u); g.globalAlpha = 1; }
      if (h.warn) { g.fillStyle = '#ff5a3a'; g.font = font(sans, 38 * u); g.fillText(h.warn, W / 2, H * 0.3); }
      if (h.hint) { g.globalAlpha = clamp(h.hint.t, 0, 1); g.fillStyle = 'rgba(8,9,12,0.6)'; g.font = font(mono, 12 * u); const tw = g.measureText(h.hint.text).width; rr(pad, H - pad - 34 * u, tw + 28 * u, 32 * u, 10 * u); g.fill(); g.fillStyle = '#d9d4c4'; g.textAlign = 'left'; g.fillText(h.hint.text, pad + 14 * u, H - pad - 13 * u); g.globalAlpha = 1; g.textAlign = 'center'; }
    };
    function rr(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
    R.hudRoundRect = rr;
    return R;
  }

  TD.Render = { create, createFx, drawCarTop, drawCarSide, shade, alpha };
})();
