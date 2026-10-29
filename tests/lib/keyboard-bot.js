/* A keyboard-style player model for tests: binary steer / throttle / brake decisions at 20 Hz with a dead-band, like fingers on keys.
 * It looks at the road ahead (pure-pursuit target) and the corner speed the course allows, optionally taps the handbrake to start a
 * drift at the entry of a drift zone and holds the slide with the throttle. It is deliberately simple: it stands in for "a casual
 * player", not for a skilled one. Use: const bot = makeBot(race, { drift: true }); then Race.step(race, bot(race)) each step. */
function makeBot(race, opt) {
  opt = opt || {}; const T = global.TD, track = race.track, pl = race.player;
  const prof = T.AI.speedProfile(track, pl.c.p, opt.skill == null ? 0.6 : opt.skill);
  const st = { key: { thr: 0, brk: 0, steer: 0 }, n: 0, mode: 0, dir: 0, t0: 0, until: 0 };
  return function (r) {
    const c = pl.c, q = track.query(c.x, c.y, pl.hint); st.n++;
    if (st.n % 6 === 1) {                                                  // a "key decision" every 50 ms
      const sp = Math.max(c.vx, 0), Ld = Math.max(7, 6 + 0.5 * sp), tgt = track.poseAt(q.s + Ld, 0), ca = Math.cos(c.th), sa = Math.sin(c.th);
      const dx = tgt.x - c.x, dy = tgt.y - c.y; let a = Math.atan2(-sa * dx + ca * dy, ca * dx + sa * dy); if (sp > 4) a -= c.beta;
      st.key.steer = a > 0.07 ? 1 : a < -0.07 ? -1 : 0;
      const i = Math.min(track.n - 2, q.idx + Math.ceil(Math.max(6, sp * 0.4) / track.ds)), vt = Math.min(prof[q.idx], prof[i]) * (opt.speedMul || 1);
      st.key.thr = sp < vt - 0.5 ? 1 : 0; st.key.brk = sp > vt + 2.5 ? 1 : 0;
    }
    const inp = { throttle: st.key.thr, brake: st.key.brk, steer: st.key.steer, handbrake: false, kick: false };
    if (opt.drift && !pl.finished && r.state === 'running') {
      const z = track.zoneAt(q.s + (st.mode ? 0 : 8)), zin = track.zoneAt(q.s);
      if (!st.mode && z && c.speed > 10 && Math.abs(c.beta) < 0.12 && r.steps > st.until) { st.mode = 1; st.dir = Math.sign(z.turn); st.t0 = r.steps; }
      if (st.mode) { const el = r.steps - st.t0, b = c.beta * -st.dir;
        if (el < (opt.tap || 36)) { inp.handbrake = true; inp.steer = st.dir; inp.throttle = 1; inp.brake = 0; }                      // tap the handbrake while turning in
        else if ((zin || z) && el < 900) { inp.steer = st.dir; inp.throttle = b < 0.45 ? 1 : b < 0.62 ? 0.5 : 0; inp.brake = 0; }     // hold the slide: keep steering into the corner, manage the angle with the throttle
        else { st.mode = 0; st.until = r.steps + 120; } }
    }
    return inp;
  };
}
module.exports = { makeBot };
