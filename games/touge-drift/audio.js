/* Touge Drift - procedural audio (Web Audio, no files). Engine, tyre squeal, wind, collisions, UI and jingles.
 * The AudioContext is created on the first user gesture (browsers refuse to start audio earlier) and suspended when the
 * page is hidden. Volume and mute come from the settings; the launcher's "start games muted" preference is honoured. */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  let ctx = null, master = null, vol = 0.7, muted = false, nodes = null, noiseBuf = null;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : vol * 0.8; master.connect(ctx.destination);
    // one second of white noise, looped for tyres / wind and sliced for impacts
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); let seed = 1; for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
    buildEngine();
    return ctx;
  }
  function loopNoise() { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }

  function buildEngine() {
    const eng = { o1: ctx.createOscillator(), o2: ctx.createOscillator(), o3: ctx.createOscillator(), f: ctx.createBiquadFilter(), g: ctx.createGain(), sub: ctx.createGain() };
    eng.o1.type = 'sawtooth'; eng.o2.type = 'square'; eng.o3.type = 'triangle'; eng.f.type = 'lowpass'; eng.f.Q.value = 2.2;
    eng.g.gain.value = 0; eng.sub.gain.value = 0.5;
    eng.o1.connect(eng.f); eng.o2.connect(eng.sub); eng.sub.connect(eng.f); eng.o3.connect(eng.f); eng.f.connect(eng.g); eng.g.connect(master);
    eng.o1.start(); eng.o2.start(); eng.o3.start();
    const sq = { src: loopNoise(), f: ctx.createBiquadFilter(), g: ctx.createGain() }; sq.f.type = 'bandpass'; sq.f.Q.value = 6; sq.g.gain.value = 0; sq.src.connect(sq.f); sq.f.connect(sq.g); sq.g.connect(master); sq.src.start();
    const wd = { src: loopNoise(), f: ctx.createBiquadFilter(), g: ctx.createGain() }; wd.f.type = 'lowpass'; wd.f.frequency.value = 500; wd.g.gain.value = 0; wd.src.connect(wd.f); wd.f.connect(wd.g); wd.g.connect(master); wd.src.start();
    const gr = { src: loopNoise(), f: ctx.createBiquadFilter(), g: ctx.createGain() }; gr.f.type = 'lowpass'; gr.f.frequency.value = 900; gr.g.gain.value = 0; gr.src.connect(gr.f); gr.f.connect(gr.g); gr.g.connect(master); gr.src.start();
    nodes = { eng, sq, wd, gr };
  }

  /** Per-frame update from the player's car. state: { rpm 0..1, throttle 0..1, skid 0..1, speed m/s, offroad bool, spin 0..1 } or null (silence). */
  function update(st) {
    if (!ctx || !nodes) return; const t = ctx.currentTime, e = nodes.eng;
    if (!st) { e.g.gain.setTargetAtTime(0, t, 0.05); nodes.sq.g.gain.setTargetAtTime(0, t, 0.05); nodes.wd.g.gain.setTargetAtTime(0, t, 0.05); nodes.gr.g.gain.setTargetAtTime(0, t, 0.05); return; }
    const f0 = 34 + st.rpm * 120 + (st.spin || 0) * 18;
    e.o1.frequency.setTargetAtTime(f0, t, 0.03); e.o2.frequency.setTargetAtTime(f0 * 0.5, t, 0.03); e.o3.frequency.setTargetAtTime(f0 * 2.01, t, 0.03);
    e.f.frequency.setTargetAtTime(420 + st.rpm * 1500 + st.throttle * 900, t, 0.04);
    e.g.gain.setTargetAtTime(0.16 + 0.2 * st.throttle + 0.06 * st.rpm, t, 0.05);
    nodes.sq.f.frequency.setTargetAtTime(1500 + st.speed * 18 + st.skid * 500, t, 0.05);
    nodes.sq.g.gain.setTargetAtTime(Math.pow(clamp(st.skid, 0, 1), 1.3) * 0.22 * (st.speed > 3 ? 1 : 0), t, 0.04);
    nodes.wd.f.frequency.setTargetAtTime(300 + st.speed * 18, t, 0.1);
    nodes.wd.g.gain.setTargetAtTime(clamp(st.speed / 80, 0, 1) * 0.12, t, 0.1);
    nodes.gr.g.gain.setTargetAtTime(st.offroad ? clamp(st.speed / 25, 0, 1) * 0.2 : 0, t, 0.08);
  }

  function burst(len, f0, f1, gain, type) {
    if (!ctx || muted) return; const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type || 'lowpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + len);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5, len + 0.05);
  }
  function tone(freq, len, type, gain, delay, slideTo) {
    if (!ctx || muted) return; const t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + len + 0.05);
  }
  const play = {
    hit(impact) { const k = clamp(impact / 12, 0.15, 1); burst(0.35, 1800, 120, 0.4 * k); tone(90, 0.2, 'sawtooth', 0.2 * k, 0, 40); },
    bump(impact) { const k = clamp(impact / 8, 0.1, 1); burst(0.2, 1200, 200, 0.25 * k); },
    click() { tone(880, 0.05, 'square', 0.07); }, back() { tone(520, 0.06, 'square', 0.06); }, buy() { tone(660, 0.08, 'triangle', 0.14); tone(990, 0.12, 'triangle', 0.14, 0.07); tone(1320, 0.16, 'triangle', 0.12, 0.14); },
    deny() { tone(160, 0.18, 'sawtooth', 0.12); },
    count(n) { tone(n === 0 ? 1180 : 620, n === 0 ? 0.5 : 0.18, 'square', 0.14); },
    checkpoint() { tone(990, 0.08, 'triangle', 0.14); tone(1480, 0.14, 'triangle', 0.13, 0.07); },
    bank() { tone(740, 0.07, 'triangle', 0.1); tone(1110, 0.1, 'triangle', 0.1, 0.05); },
    reset() { tone(300, 0.2, 'sawtooth', 0.1, 0, 120); },
    finish(medal) { const seq = medal >= 3 ? [523, 659, 784, 1047, 1319] : medal === 2 ? [523, 659, 784, 1047] : medal === 1 ? [523, 659, 784] : [392, 330]; seq.forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, i * 0.11)); },
    complete() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.1, i * 0.09)); },
  };

  function setVolume(v) { vol = clamp(v, 0, 1); if (master) master.gain.setTargetAtTime(muted ? 0 : vol * 0.8, ctx.currentTime, 0.02); }
  function setMuted(m) { muted = !!m; if (master) master.gain.setTargetAtTime(muted ? 0 : vol * 0.8, ctx.currentTime, 0.02); }
  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }
  const silent = () => update(null);
  TD.Audio = { ensure, update, silent, play, setVolume, setMuted, suspend, resume, get running() { return !!ctx && ctx.state === 'running'; }, get muted() { return muted; } };
})();
