/* Touge Drift - vehicle physics. Pure maths, no DOM (runs in Node for the tests).
 *
 * Bicycle model in the car's body frame: x forward, y to the RIGHT, yaw rate w positive = turning right (clockwise on the
 * y-down canvas). State: vx (longitudinal), vy (lateral), w (yaw rate). Each axle makes a lateral force from its slip
 * angle through a tyre curve that rises to a peak, then falls to a lower sliding grip. Drive/brake forces share each axle's
 * friction circle with its lateral force, and load moves between axles with acceleration (weight transfer).
 * Drifting is therefore emergent: rear grip is exceeded (throttle, handbrake, clutch kick, lift-off) and the
 * car slides until traction returns; nothing is rotated by a script.
 * Fixed step: DT = 1/120 s. */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const G = 9.81, DT = 1 / 120;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const sign = v => v < 0 ? -1 : 1;
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  /* Normalised tyre curve: x = slip / peak slip. Smooth rise to 1 at x = 1, then falls to `slide` (sliding grip ratio). */
  function tyre(x, slide, fall) {
    if (x < 1) return Math.sin(Math.PI / 2 * x);
    return slide + (1 - slide) * Math.exp(-(x - 1) * fall);
  }

  /** New car state from physical parameters `p` (see vehicles.js toPhysics). */
  function createCar(p, x, y, heading) {
    return {
      p, x: x || 0, y: y || 0, th: heading || 0, vx: 0, vy: 0, w: 0,
      steer: 0, steerAngle: 0, axs: 0, aF: 0, aR: 0, kickT: 0, kickCd: 0, hb: 0,
      // telemetry (read by effects, audio, scoring)
      speed: 0, beta: 0, rpm: 0.2, gear: 1, spin: 0, skid: 0, latG: 0, lonG: 0, onSurface: 1, slipF: 0, slipR: 0, drive: 0,
      impact: 0, wallScrape: 0,
    };
  }

  /** One fixed step. input: { throttle 0..1, brake 0..1, steer -1..1 (smoothed by caller), handbrake bool, kick bool }.
   *  surf: grip multiplier of the surface under the car (1 road, ~0.65 gravel). */
  function step(car, input, surf) {
    const p = car.p, dt = DT;
    surf = surf == null ? 1 : surf;
    const m = p.mass, a = p.L * (1 - p.wf), b = p.L * p.wf;     // a: CG to front axle, b: CG to rear axle
    let { vx, vy, w } = car;
    const thr = clamp(input.throttle || 0, 0, 1), brk = clamp(input.brake || 0, 0, 1);

    // ---- steering (speed sensitive) ----
    const v = Math.hypot(vx, vy);
    const dmax = p.steerMax / (1 + Math.pow(v / p.steerVRef, 2) * 0.55);
    const delta = clamp(input.steer || 0, -1, 1) * dmax * (vx < -0.5 ? -1 : 1);
    car.steerAngle = delta;

    // ---- clutch kick / handbrake state ----
    if (car.kickCd > 0) car.kickCd -= dt;
    if (input.kick && car.kickCd <= 0 && v > 5) { car.kickT = 0.45; car.kickCd = 1.0; }
    const kickEnv = car.kickT > 0 ? Math.min(1, car.kickT / 0.3) : 0;     // full strength for 0.15 s, then fading
    if (car.kickT > 0) car.kickT -= dt;
    const hb = !!input.handbrake;
    car.hb += ((hb ? 1 : 0) - car.hb) * Math.min(1, dt * 14);

    // ---- weight transfer (smoothed longitudinal acceleration) ----
    const W = m * G, xfer = clamp(m * car.axs * p.hCg / p.L, -0.28 * W, 0.28 * W);
    const FzF = Math.max(0.12 * W, W * p.wf - xfer), FzR = Math.max(0.12 * W, W * (1 - p.wf) + xfer);

    // ---- longitudinal demands ----
    let demand = 0, brakeF = 0;
    const fwd = vx > 0.6, rev = vx < -0.6;
    const vv = Math.max(vx, 1.5);
    const Fpow = Math.min(p.fPeak, p.power / vv) * (vx > p.topSpeed * 0.985 ? 0 : 1);
    if (thr > 0 || kickEnv > 0) {
      const t = Math.max(thr, kickEnv > 0 ? 0.85 : 0);
      if (rev) brakeF = t * p.brakeG * W * 0.9;                              // throttle while rolling backwards = braking
      else demand = t * Fpow;
      // clutch kick: a sharp torque spike that overwhelms the driven tyres (strength tied to their grip, not to power),
      // which is how a drift is started without the handbrake
      if (!rev && kickEnv > 0) demand = Math.max(demand, kickEnv * 2.7 * p.muR * surf * FzR * (p.drive === 'FWD' ? 0 : 1) + (p.drive === 'FWD' ? 1.5 * p.muF * surf * FzF * kickEnv : 0));
    }
    if (brk > 0) {
      if (fwd) brakeF = Math.max(brakeF, brk * p.brakeG * W);
      else if (!thr) demand = -brk * Math.min(p.fPeak * 0.5, p.power * 0.4 / Math.max(-vx, 2.5)) * (vx < -9 ? 0 : 1);
    }
    if (!thr && !brk && !kickEnv && Math.abs(vx) > 0.3) brakeF = Math.max(brakeF, 0.045 * W);   // engine braking / coasting
    // split drive between axles
    let dF = 0, dR = 0;
    if (p.drive === 'RWD') dR = demand; else if (p.drive === 'FWD') dF = demand;
    else { const rs = 0.4 + 0.25 * p.diff; dR = demand * rs; dF = demand * (1 - rs); }
    const dirV = vx >= 0 ? 1 : -1, stopped = Math.abs(vx) < 0.35;
    const bF = brakeF * 0.64, bR = brakeF * 0.36;
    const muHB = 1 - 0.58 * car.hb;                                            // locked rear wheels slide at ~0.4 of grip
    let FxF = dF - dirV * bF, FxR = dR - dirV * bR;
    if (car.hb > 0.05 && !stopped) FxR -= dirV * car.hb * 0.9 * p.muR * surf * FzR;   // handbrake drag on the rear axle

    // ---- tyre forces: longitudinal demand + slip-curve lateral force, limited together by the friction circle ----
    // (both components are scaled by the same factor, so wheelspin and braking cost sideways grip, but a sliding tyre keeps
    //  a useful share of it - that is what lets a drift be held on the throttle)
    const muF = p.muF * surf, muR = p.muR * surf * muHB * (p.drive === 'FWD' ? 1 : 1 - 0.34 * kickEnv);   // a kick shocks the driveline and unloads the rear tyres
    const capF = muF * FzF, capR = muR * FzR;
    const spinDemand = Math.abs(dR) > 0 ? Math.abs(dR) / Math.max(capR, 1) : (Math.abs(dF) > 0 ? Math.abs(dF) / Math.max(capF, 1) : 0);
    car.spin = clamp(spinDemand - 0.85, 0, 1.5) * (v > 1 ? 1 : 0.4) + (kickEnv > 0 ? 0.35 * kickEnv : 0);
    const couple = p.drive === 'FWD' ? 1 : 1.12 - 0.3 * p.diff;                  // open diffs give up more cornering grip under power
    const vmin = Math.max(Math.abs(vx), 2.2), sg = vx >= 0 ? 1 : -1;
    const aFt = Math.atan2(vy + a * w, vmin) - delta * sg;
    const aRt = Math.atan2(vy - b * w, vmin);
    // tyre relaxation: slip angle follows the geometric slip with a short lag (progressive grip build-up and loss)
    const relax = Math.min(1, dt * Math.max(v, 3) / 0.55);
    car.aF += (aFt - car.aF) * relax; car.aR += (aRt - car.aR) * relax;
    const xF = Math.abs(car.aF) / p.alphaF, xR = Math.abs(car.aR) / p.alphaR;
    const slideR = p.slideR + 0.05 * p.diff;
    let FxF2 = FxF, FxR2 = FxR;
    let FyF = -sign(car.aF) * capF * tyre(xF, p.slideF, p.fallF);
    let FyR = -sign(car.aR) * capR * tyre(xR, slideR, p.fallR);
    const MF = Math.hypot(FxF, FyF), MR = Math.hypot(FxR * (dR !== 0 ? couple : 1), FyR);
    const sF = MF > capF ? capF / MF : 1, sR = MR > capR ? capR / MR : 1;
    FxF2 *= sF; FyF *= sF; FxR2 *= sR; FyR *= sR;
    FxF = FxF2; FxR = FxR2;
    car.slipF = xF; car.slipR = xR;

    // ---- body-frame equations ----
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const fxF = FxF * cd - FyF * sd, fyF = FyF * cd + FxF * sd;
    const drag = p.kDrag * vx * Math.abs(vx) + (surf < 0.9 ? 0.055 : 0.014) * W * Math.tanh(vx * 2);
    const Fx = fxF + FxR - drag;
    const Fy = fyF + FyR - 0.5 * m * 0.0 - p.kDragY * vy * Math.abs(vy);
    const torque = a * fyF - b * FyR - p.yawDamp * w * (1 + 0.5 * Math.min(1, Math.abs(w)));
    const ax = Fx / m + w * vy, ay = Fy / m - w * vx;
    vx += ax * dt; vy += ay * dt; w += torque / p.iz * dt;
    // standstill / crawl: kill creep so the car can park, stay stable at tiny speeds
    if (Math.abs(vx) < 0.4 && !thr && !brk && !kickEnv) { vx *= 1 - Math.min(1, dt * 6); }
    if (Math.hypot(vx, vy) < 3) { const k = Math.min(1, dt * (3 - Math.hypot(vx, vy)) * 4); vy -= vy * k; w -= w * k; }
    car.axs += (ax - w * vy - car.axs) * Math.min(1, dt * 9);                    // low-pass for weight transfer (avoids chatter)
    car.vx = vx; car.vy = vy; car.w = w;

    // ---- integrate pose ----
    const c = Math.cos(car.th), s = Math.sin(car.th);
    car.x += (vx * c - vy * s) * dt; car.y += (vx * s + vy * c) * dt;
    car.th = wrap(car.th + w * dt);

    // ---- telemetry ----
    car.speed = Math.hypot(vx, vy);
    car.beta = car.speed > 3 ? Math.atan2(vy, Math.abs(vx)) * (vx >= 0 ? 1 : -1) : 0;
    car.latG = ay / G; car.lonG = ax / G;
    car.skid = clamp(Math.max((xR - 1) * 0.9, (xF - 1) * 0.9, car.spin * 0.6, car.hb * (car.speed > 4 ? 0.9 : 0)), 0, 1) * (car.speed > 3 ? 1 : 0);
    car.onSurface = surf;
    car.drive = Math.max(0, demand) / Math.max(1, p.fPeak);
    // gearbox for rpm / sound (cosmetic; the force model above does not depend on it)
    const tops = p.gearTops; let g = tops.length - 1;
    for (let i = 0; i < tops.length; i++) if (car.speed / tops[i] < 0.9) { g = i; break; }
    car.gear = g + 1;
    const target = clamp(0.2 + 0.8 * car.speed / tops[g], 0.2, 1) + car.spin * 0.12 + kickEnv * 0.25;
    car.rpm += (clamp(target, 0.18, 1.08) - car.rpm) * Math.min(1, dt * 14);
  }

  /* ---- collisions with the road boundary / other cars ----
   * Each car is a rectangle (half length hl, half width hw); the four corners and two side midpoints are tested
   * against the guard rail line. An impulse (with friction) is applied at the contact point, so wall hits spin the car. */
  function wallImpulse(car, px, py, nx, ny, restitution) {
    const p = car.p, m = p.mass, I = p.iz;
    const c = Math.cos(car.th), s = Math.sin(car.th);
    const Vx = car.vx * c - car.vy * s, Vy = car.vx * s + car.vy * c;
    const rx = px - car.x, ry = py - car.y;
    const pvx = Vx - car.w * ry, pvy = Vy + car.w * rx;                       // point velocity (w: x->y positive)
    const vn = pvx * nx + pvy * ny;
    if (vn >= 0) return 0;
    const rn = rx * ny - ry * nx;
    const j = -(1 + restitution) * vn / (1 / m + rn * rn / I);
    // friction along the wall (Coulomb, capped)
    const tx = -ny, ty = nx, vt = pvx * tx + pvy * ty, rt = rx * ty - ry * tx;
    const jt = clamp(-vt / (1 / m + rt * rt / I), -0.35 * j, 0.35 * j);
    const Jx = j * nx + jt * tx, Jy = j * ny + jt * ty;
    const nVx = Vx + Jx / m, nVy = Vy + Jy / m;
    car.w += (rx * Jy - ry * Jx) / I;
    car.vx = nVx * c + nVy * s; car.vy = -nVx * s + nVy * c;
    return -vn;
  }

  /** Keep the car inside the rail. `track.query(x, y, hint)` returns { offset, nx, ny, ... } (offset: + right of centre).
   *  Returns impact speed (m/s) of the hardest hit this step (0 = none). */
  function collideTrack(car, track, hint) {
    const p = car.p, c = Math.cos(car.th), s = Math.sin(car.th);
    const pts = [[p.hl, p.hw], [p.hl, -p.hw], [-p.hl, p.hw], [-p.hl, -p.hw], [0, p.hw], [0, -p.hw]];
    let worst = 0, scrape = 0;
    const rail = track.railOffset - 0.12;
    for (let k = 0; k < pts.length; k++) {
      const lx = pts[k][0], ly = pts[k][1];
      const wx = car.x + lx * c - ly * s, wy = car.y + lx * s + ly * c;
      const q = track.query(wx, wy, hint);
      const over = Math.abs(q.offset) - rail;
      if (over <= 0) continue;
      const side = q.offset > 0 ? 1 : -1;
      const nx = -q.nx * side, ny = -q.ny * side;                              // normal pointing back toward the road
      car.x += nx * over * 0.9; car.y += ny * over * 0.9;                     // depenetrate
      const imp = wallImpulse(car, wx + nx * over * 0.9, wy + ny * over * 0.9, nx, ny, 0.22);
      if (imp > worst) worst = imp;
      scrape = Math.max(scrape, 1);
    }
    car.wallScrape = scrape; car.impact = worst;
    if (worst > 0) { car.speed = Math.hypot(car.vx, car.vy); }
    return worst;
  }

  /** Soft car-vs-car contact (circles along the body). Returns impact speed. */
  function collideCars(A, B) {
    const dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy, R = A.p.hw + B.p.hw + 1.4;
    if (d2 > (A.p.hl + B.p.hl) * (A.p.hl + B.p.hl) || d2 < 1e-6) return 0;
    const ca = Math.cos(A.th), sa = Math.sin(A.th), cb = Math.cos(B.th), sb = Math.sin(B.th);
    let worst = 0;
    for (const la of [-A.p.hl * 0.55, 0, A.p.hl * 0.55]) for (const lb of [-B.p.hl * 0.55, 0, B.p.hl * 0.55]) {
      const ax = A.x + la * ca, ay = A.y + la * sa, bx = B.x + lb * cb, by = B.y + lb * sb;
      const ddx = bx - ax, ddy = by - ay, dd = Math.hypot(ddx, ddy);
      if (dd >= R || dd < 1e-4) continue;
      const nx = ddx / dd, ny = ddy / dd, over = R - dd;
      A.x -= nx * over * 0.25; A.y -= ny * over * 0.25; B.x += nx * over * 0.25; B.y += ny * over * 0.25;
      const VAx = A.vx * ca - A.vy * sa, VAy = A.vx * sa + A.vy * ca, VBx = B.vx * cb - B.vy * sb, VBy = B.vx * sb + B.vy * cb;
      const vn = (VBx - VAx) * nx + (VBy - VAy) * ny;
      if (vn >= 0) continue;
      const mA = A.p.mass, mB = B.p.mass, j = -(1.1) * vn / (1 / mA + 1 / mB);
      const nAx = VAx - j * nx / mA, nAy = VAy - j * ny / mA, nBx = VBx + j * nx / mB, nBy = VBy + j * ny / mB;
      A.vx = nAx * ca + nAy * sa; A.vy = -nAx * sa + nAy * ca; B.vx = nBx * cb + nBy * sb; B.vy = -nBx * sb + nBy * cb;
      worst = Math.max(worst, -vn);
    }
    return worst;
  }

  /** Steering-input smoothing + countersteer assist (driver-side, not part of the car model).
   *  assist 0..1 acts like a driver's hands: while the car is sliding it steers toward the direction of travel
   *  (countersteer). Your input then sets how much of the angle you keep: holding into the corner keeps the slide,
   *  releasing lets the assist straighten the car. Keyboard steering is binary, so without this a slide is nearly
   *  impossible to hold; with assist 0 you get raw, unaided steering. */
  function driverSteer(car, rawSteer, assist, dt) {
    let target = rawSteer;
    if (assist > 0 && car.speed > 6) {
      const cs = clamp(car.beta / 0.42, -1, 1);                                   // full countersteer at ~24 degrees of slip
      const sw = clamp((Math.abs(car.beta) - 0.06) / 0.2, 0, 1) * assist * clamp((car.speed - 6) / 6, 0, 1);
      // the more the player steers into the corner (same direction as the slide's rotation), the less countersteer
      const intoSlide = rawSteer * -Math.sign(car.beta || 1);                    // +1 = steering into the corner of the slide
      const keep = clamp(0.5 * intoSlide + 0.1, 0, 0.62);
      target = clamp((1 - sw) * rawSteer + sw * (cs * (1 - keep) + rawSteer * keep * 0.6), -1, 1);
    }
    const rate = (Math.abs(target) > Math.abs(car.steer) && Math.sign(target) === Math.sign(car.steer || target)) ? 6.5 : 10;
    const d = target - car.steer, mx = rate * dt;
    car.steer += clamp(d, -mx, mx);
  }

  /** Pedal smoothing: keyboard throttle/brake are on-off, real pedals are not (ramps keep the rear from snapping loose). */
  function driverPedals(car, thrIn, brkIn, dt, assist) {
    car.thr = car.thr || 0; car.brk = car.brk || 0;
    // drift assist: past ~35 degrees of slip, ease the throttle so a held slide does not wind up into a spin
    if (assist > 0) thrIn *= 1 - assist * clamp((Math.abs(car.beta) - 0.6) / 0.4, 0, 0.85);
    car.thr += clamp(thrIn - car.thr, -dt / 0.10, dt / 0.26);
    car.brk += clamp(brkIn - car.brk, -dt / 0.08, dt / 0.12);
  }

  TD.Physics = { driverPedals, DT, G, step, createCar, collideTrack, collideCars, driverSteer, tyre, clamp, wrap };
})();
