/* Touge Drift - AI drivers. They drive the same physics as the player (same cars, same tyres): a racing line from the
 * road's curvature gives a target speed everywhere (braking distances worked out backwards from each corner), a pure-pursuit
 * steering law follows the road, and `skill` (0.5 .. 1) scales how close to the limit they run and how often they
 * misjudge a corner. Nothing about the race result is scripted. */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const P = () => TD.Physics, clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /** Target speed profile (m/s) along the road for a car with physics params p at the given skill. */
  function speedProfile(track, p, skill) {
    const n = track.n, ds = track.ds, k = new Float64Array(n), v = new Float64Array(n);
    // smooth |curvature| a little ahead (the car has length and the driver looks ahead)
    for (let i = 0; i < n; i++) { let m = 0; for (let j = Math.max(0, i - 5); j <= Math.min(n - 1, i + 9); j++) m = Math.max(m, Math.abs(track.kappa[j])); k[i] = m; }
    const mu = (p.muF * (1 - p.wf) + p.muR * p.wf) * (0.97 + 0.03 * skill);
    const aLat = P().G * mu * (0.62 + 0.26 * skill);                      // fraction of the grip limit used
    const vTop = p.topSpeed * (0.9 + 0.1 * skill);
    for (let i = 0; i < n; i++) v[i] = Math.min(vTop, Math.sqrt(aLat / Math.max(k[i], 1e-4)));
    const aBr = P().G * Math.min(1.1, p.brakeG) * (0.5 + 0.28 * skill);
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * aBr * ds));
    return v;
  }

  function createDriver(track, p, skill, seed) {
    const rnd = TD.Tracks.rng((seed || 1) * 977 + 3), prof = speedProfile(track, p, skill);
    // per-corner misjudgement (seeded): low-skill drivers sometimes carry too much speed into a corner
    const errs = new Float64Array(Math.ceil(track.n / 60) + 2); for (let i = 0; i < errs.length; i++) errs[i] = 1 + (rnd() - 0.55) * 0.38 * (1 - skill) * 2 + (rnd() < (1 - skill) * 0.35 ? 0.1 : 0);
    const d = { track, p, skill, prof, hint: -1, stuck: 0, wrong: 0, recoveries: 0, lane: 0, laneT: 0 };
    d.drive = function (car, q, dt, slow) {
      const speed = Math.max(car.vx, 0), n = track.n;
      const i = clamp(q.idx, 0, n - 2);
      // --- speed ---
      const look = Math.min(n - 2, i + Math.ceil(Math.max(6, speed * 0.35) / track.ds));
      let vt = Math.min(prof[i], prof[look]) * errs[Math.floor(i / 60)];
      if (slow) vt = 0;                                                               // after the finish line: stop on the road
      const thr = clamp((vt - speed) / 3.5, 0, 1), brk = speed > vt + 0.8 ? clamp((speed - vt) / 4, 0, 1) : 0;
      // --- steering: pure pursuit toward a point on the road ahead ---
      const Ld = clamp(5 + 0.55 * speed, 6.5, 32), sT = q.s + Ld;
      // aim a little toward the inside of the bend (a bit of line shaping, capped well inside the road)
      const kk = track.kappa[clamp(Math.round(sT / track.ds), 0, n - 1)];
      const lane = clamp(kk * 55, -2.2, 2.2) * 0.8;
      const tgt = track.poseAt(sT, lane);
      const ca = Math.cos(car.th), sa = Math.sin(car.th), dx = tgt.x - car.x, dy = tgt.y - car.y;
      let alpha = Math.atan2(-sa * dx + ca * dy, ca * dx + sa * dy);                // angle to target in the car frame (+ = right)
      if (car.speed > 4) alpha -= car.beta;                                          // aim relative to where the car is actually travelling
      const dmax = car.p.steerMax / (1 + Math.pow(Math.hypot(car.vx, car.vy) / car.p.steerVRef, 2) * 0.55);
      let steer = Math.atan2(2 * car.p.L * Math.sin(alpha), Ld) / dmax;
      // countersteer when the car is sliding
      if (Math.abs(car.beta) > 0.17) steer += Math.sign(car.beta) * clamp((Math.abs(car.beta) - 0.17) / 0.3, 0, 1) * 0.9;
      steer = clamp(steer, -1, 1);
      // --- stuck / facing the wrong way: put the car back on the road (costs the AI the time it lost) ---
      const rel = Math.cos(q.hd - car.th);
      if ((car.speed < 1.5 && !slow) || rel < 0.2) d.stuck += dt; else d.stuck = Math.max(0, d.stuck - dt * 2);   // wedged against the rail, or facing backwards
      return { throttle: thr, brake: brk, steer, handbrake: false, kick: false, recover: d.stuck > 3.2 };
    };
    return d;
  }
  TD.AI = { createDriver, speedProfile };
})();
