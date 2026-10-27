/* Touge Drift - drift scoring. Pure logic (no DOM).
 * A drift is counted only while the car is genuinely sliding: speed above DRIFT_MIN_SPEED, slip angle (heading vs the
 * direction of travel, computed from the physics state) between 11 and 77 degrees, on the road, moving forward.
 * Spinning in place, reversing and sliding on the grass score nothing. Points per second grow with angle (peak ~35 deg)
 * and speed; a combo multiplier builds while the drift lasts and jumps when you switch direction smoothly; drift zones
 * double the points. A drift is "banked" once you straighten out; hitting a wall throws away what you had not banked (and costs a little of what you had). */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const MIN_SPEED = 8, MIN_ANGLE = 0.2, MAX_ANGLE = 1.35, ENTRY_DELAY = 0.35, BANK_DELAY = 0.7;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  function create() {
    return { score: 0, chain: 0, combo: 1, active: false, t: 0, gap: 0, sign: 0, lastFlip: -9, flips: 0, hitCd: 0, zone: false,
             angle: 0, maxAngle: 0, best: 0, drifts: 0, hits: 0, time: 0, events: [], lastBank: 0, rate: 0 };
  }

  /** car: physics state (speed, beta, vx); onRoad: bool; inZone: bool; impact: wall impact speed this step (0 = none). */
  function update(d, car, onRoad, inZone, impact, dt) {
    d.time += dt; d.events.length = 0; d.zone = !!inZone;
    if (d.hitCd > 0) d.hitCd -= dt;
    const ab = Math.abs(car.beta);
    d.angle = car.beta;
    const eligible = onRoad && car.speed >= MIN_SPEED && car.vx > 2 && ab >= MIN_ANGLE && ab <= MAX_ANGLE;
    if (impact > 2.5 && d.hitCd <= 0) {                                   // crash: lose the unbanked chain, small penalty
      if (d.chain > 0 || d.active) d.events.push({ type: 'lost', points: Math.round(d.chain) });
      const pen = Math.round(Math.min(d.score * 0.25, 40 + impact * 6)); d.score -= pen;           // a crash costs the live chain plus up to a quarter of banked points (never everything) if (pen) d.events.push({ type: 'penalty', points: pen });
      d.chain = 0; d.combo = 1; d.active = false; d.t = 0; d.gap = 0; d.hits++; d.hitCd = 1.0;
    }
    if (eligible) {
      d.gap = 0; d.t += dt;
      const sgn = car.beta > 0 ? 1 : -1;
      if (d.t > ENTRY_DELAY) {
        if (!d.active) { d.active = true; d.drifts++; d.sign = sgn; d.events.push({ type: 'start' }); }
        if (sgn !== d.sign) {                                              // direction change (a transition)
          if (d.time - d.lastFlip < 2.2) { d.combo = Math.min(5, d.combo + 0.5); d.flips++; d.events.push({ type: 'transition', combo: d.combo }); }
          d.sign = sgn; d.lastFlip = d.time;
        }
        const angF = ab < 0.61 ? ab / 0.61 : 1 - 0.4 * clamp((ab - 0.61) / 0.74, 0, 1);
        const spdF = clamp((car.speed - 5) / 14, 0.25, 1.6);                  // ~1.0 at 19 m/s (68 km/h); hairpins are slow, fast sweepers pay more
        d.combo = Math.min(5, d.combo + 0.14 * dt);
        d.rate = 60 * angF * spdF * d.combo * (inZone ? 2 : 1);
        d.chain += d.rate * dt;
        d.maxAngle = Math.max(d.maxAngle, ab);
      }
    } else {
      d.rate = 0;
      if (d.active || d.chain > 0) {
        d.gap += dt;
        if (d.gap >= BANK_DELAY) bank(d);
      } else { d.t = 0; d.combo = Math.max(1, d.combo - dt * 0.5); }
      if (!d.active) d.t = 0;
    }
  }
  function bank(d) {
    const pts = Math.round(d.chain);
    if (pts > 0) { d.score += pts; d.best = Math.max(d.best, pts); d.lastBank = pts; d.events.push({ type: 'bank', points: pts }); }
    d.chain = 0; d.combo = 1; d.active = false; d.t = 0; d.gap = 0;
  }
  /** Bank whatever is running (end of the run). */
  function finish(d) { if (d.chain > 0) bank(d); return d.score; }
  const total = d => Math.round(d.score + d.chain);

  TD.Drift = { create, update, finish, total, MIN_SPEED };
})();
