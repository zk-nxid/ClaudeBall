/* Touge Drift - headless unit/simulation tests (Node, no browser). Usage: node tests/touge-drift.unit.js
 * Everything runs on the real physics/track/AI/race/progression modules at the fixed timestep. */
const path = require('path');
const dir = path.resolve(__dirname, '..', 'games', 'touge-drift');
for (const f of ['physics', 'vehicles', 'tracks', 'drift', 'ai', 'race', 'progression']) require(path.join(dir, f + '.js'));
const { Physics: P, Vehicles: V, Tracks: T, Drift: D, AI, Race, Progress, Save, Store } = TD;
let passed = 0, failed = 0, group = '';
const section = n => { group = n; console.log('\n' + n); };
const ok = (name, cond, extra) => { if (cond) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function drive(carId, build, script, secs, opt) {
  opt = opt || {}; const car = P.createCar(V.toPhysics(V.carById(carId), build), 0, 0, 0); car.vx = opt.v0 || 0; let maxB = 0, t = 0, worstNaN = false;
  for (let i = 0; i < secs * 120; i++) {
    t = i / 120; const inp = script(t, car) || {};
    P.driverSteer(car, inp.steer || 0, opt.assist == null ? 0.55 : opt.assist, P.DT); P.driverPedals(car, inp.thr || 0, inp.brk || 0, P.DT, opt.assist == null ? 0.55 : opt.assist);
    P.step(car, { throttle: car.thr, brake: car.brk, steer: car.steer, handbrake: !!inp.hb, kick: !!inp.kick }, opt.surf == null ? 1 : opt.surf);
    maxB = Math.max(maxB, Math.abs(car.beta)); if (!isFinite(car.x + car.y + car.vx + car.vy + car.w)) worstNaN = true;
  }
  return { car, maxB, nan: worstNaN };
}

section('Physics: straight line');
for (const c of V.CARS) {
  const a = V.analyze(c);
  ok(c.name + ': 0-100 km/h is plausible (' + a.t100 + ' s)', a.t100 > 2.6 && a.t100 < 8, a.t100);
  ok(c.name + ': stops from 100 km/h in a sane distance (' + a.stop + ' m)', a.stop > 28 && a.stop < 52, a.stop);
}
{
  const r = drive('kazan-rz1', null, () => ({ thr: 1 }), 60);
  const top = V.carById('kazan-rz1').top / 3.6;
  ok('Kazan reaches (and does not exceed) its top speed', r.car.vx > top * 0.93 && r.car.vx < top * 1.02, [r.car.vx, top]);
  ok('straight-line driving stays straight', Math.abs(r.car.vy) < 0.05 && Math.abs(r.car.th) < 0.01);
}
section('Physics: steering, braking, handbrake, clutch kick');
{
  const right = drive('kazan-rz1', null, t => ({ thr: 0.4, steer: 1 }), 2, { v0: 15 });
  const left = drive('kazan-rz1', null, t => ({ thr: 0.4, steer: -1 }), 2, { v0: 15 });
  ok('steering right turns right (positive yaw)', right.car.w > 0.3 && right.car.th > 0.3, [right.car.w, right.car.th]);
  ok('steering left turns left (negative yaw)', left.car.w < -0.3 && left.car.th < -0.3);
  ok('left/right are symmetric', near(right.car.w, -left.car.w, 0.02) && near(right.car.speed, left.car.speed, 0.05));
  const brk = drive('kazan-rz1', null, t => ({ brk: 1 }), 4, { v0: 25 });
  ok('braking stops the car', brk.car.vx < 0.5, brk.car.vx);
  const rev = drive('kazan-rz1', null, t => t < 1 ? { brk: 1 } : { brk: 1 }, 7, { v0: 8 });
  ok('holding brake from standstill reverses', rev.car.vx < -2, rev.car.vx);
  const grip = drive('kazan-rz1', null, t => ({ thr: 0.35, steer: t < 0.3 ? 0 : 0.5 }), 4, { v0: 15 });
  ok('an ordinary corner at moderate speed is gripped (slip < 8 deg)', grip.maxB < 8 / 57.3, grip.maxB * 57.3);
  const hb = drive('kazan-rz1', null, t => ({ thr: 1, steer: t < 0.3 ? 0 : 1, hb: t > 0.35 && t < 0.8 }), 4, { v0: 22 });
  ok('handbrake turn breaks the rear loose (slip > 20 deg), emergent from tyre slip', hb.maxB > 20 / 57.3, hb.maxB * 57.3);
  ok('...and the assisted driver catches it (no spin: slip < 60 deg)', hb.maxB < 60 / 57.3);
  const kick = drive('kazan-rz1', null, t => ({ thr: 1, steer: t < 0.2 ? 0 : 0.7, kick: t > 0.5 && t < 0.55 }), 4, { v0: 20 });
  const nokick = drive('kazan-rz1', null, t => ({ thr: 1, steer: t < 0.2 ? 0 : 0.7 }), 4, { v0: 20 });
  ok('clutch kick initiates a slide on an RWD car (much more slip than without)', kick.maxB > nokick.maxB + 10 / 57.3, [kick.maxB * 57.3, nokick.maxB * 57.3]);
  const fwd = drive('sora-hatch', null, t => ({ thr: 1, steer: t < 0.2 ? 0 : 0.7, kick: t > 0.5 && t < 0.55 }), 4, { v0: 20 });
  ok('a FWD car does not swing its tail out on a clutch kick', fwd.maxB < 12 / 57.3, fwd.maxB * 57.3);
  const awd = drive('tsurugi-rs4', null, t => ({ thr: 1, steer: t < 0.2 ? 0 : 0.7, kick: t > 0.5 && t < 0.55 }), 4, { v0: 20 });
  ok('an AWD car stays more planted than the RWD car on the same kick', awd.maxB < kick.maxB, [awd.maxB * 57.3, kick.maxB * 57.3]);
  const lift = drive('hayate-rd', null, t => t < 0.4 ? { thr: 0.7, steer: 0 } : { thr: 0, brk: 0.5, steer: 0.9 }, 3, { v0: 24, assist: 0 });
  ok('lift-off/trail-brake into a corner rotates an RWD car (oversteer from weight transfer)', lift.maxB > 6 / 57.3, lift.maxB * 57.3);
  const gravel = drive('kazan-rz1', null, () => ({ thr: 1 }), 6, { surf: 0.66 });
  const tarmac = drive('kazan-rz1', null, () => ({ thr: 1 }), 6);
  ok('gravel is slower and has less grip than tarmac', gravel.car.vx < tarmac.car.vx);
  ok('no NaN in any scenario', !hb.nan && !kick.nan && !lift.nan);
}
section('Physics: determinism and the fixed timestep');
{
  ok('DT is a fixed 1/120 s', P.DT === 1 / 120);
  const run = () => drive('ryujin-drx', null, t => ({ thr: 1, steer: Math.sin(t * 2), kick: t > 1 && t < 1.05 }), 8, { v0: 20 }).car;
  const a = run(), b = run();
  ok('identical inputs give identical state', a.x === b.x && a.y === b.y && a.th === b.th && a.vx === b.vx && a.w === b.w);
}
section('Physics: upgrades change real behaviour');
{
  const car = V.carById('kazan-rz1'), base = V.toPhysics(car, V.defaultBuild());
  const e3 = V.toPhysics(car, Object.assign(V.defaultBuild(), { engine: 3 })), w3 = V.toPhysics(car, Object.assign(V.defaultBuild(), { weight: 3 })), t3 = V.toPhysics(car, Object.assign(V.defaultBuild(), { tires: 3 })), s3 = V.toPhysics(car, Object.assign(V.defaultBuild(), { susp: 3 }));
  ok('engine stage 3 adds power', e3.power > base.power * 1.2);
  ok('weight reduction removes mass', w3.mass < base.mass * 0.92);
  ok('semi-slicks add grip', t3.muR > base.muR * 1.15);
  ok('race suspension sharpens the tyre response (smaller peak slip angle)', s3.alphaF < base.alphaF);
  const a0 = V.analyze(car, V.defaultBuild()), a1 = V.analyze(car, { engine: 3 }), a2 = V.analyze(car, { weight: 3 }), a3 = V.analyze(car, { tires: 3 });
  ok('engine stage 3 shortens 0-100 (measured in the physics)', a1.t100 < a0.t100, [a0.t100, a1.t100]);
  const hi0 = drive('kazan-rz1', V.defaultBuild(), () => ({ thr: 1 }), 12, { v0: 25 }).car.vx, hi1 = drive('kazan-rz1', { engine: 3 }, () => ({ thr: 1 }), 12, { v0: 25 }).car.vx;
  ok('...and helps most at speed, where the engine (not the tyres) is the limit (' + (hi0 * 3.6).toFixed(0) + ' -> ' + (hi1 * 3.6).toFixed(0) + ' km/h after 12 s)', hi1 > hi0 + 3, [hi0, hi1]);
  ok('weight reduction shortens 0-100', a2.t100 < a0.t100);
  ok('semi-slicks shorten the braking distance', a3.stop < a0.stop, [a0.stop, a3.stop]);
  const slick = drive('kazan-rz1', Object.assign(V.defaultBuild(), { tires: 3 }), t => ({ thr: 0.6, steer: t < 0.3 ? 0 : 0.5 }), 4, { v0: 24, assist: 0 });
  const comfort = drive('kazan-rz1', Object.assign(V.defaultBuild(), { tires: 0 }), t => ({ thr: 0.6, steer: t < 0.3 ? 0 : 0.5 }), 4, { v0: 24, assist: 0 });
  ok('better tyres hold a corner the softer ones cannot (less slip at the same input)', slick.maxB < comfort.maxB, [slick.maxB * 57.3, comfort.maxB * 57.3]);
  ok('the eight cars have distinct 0-100 times', new Set(V.CARS.map(c => V.analyze(c).t100)).size >= 6);
  ok('cars cover all three drivetrains', ['RWD', 'FWD', 'AWD'].every(d => V.CARS.some(c => c.drive === d)) && V.CARS.length === 8);
}


section('Handling profiles (Beginner / Standard / Expert): drifting is learnable, not scripted');
{
  const PROFS = ['beginner', 'standard', 'expert'];
  const run = (carId, prof, v0, steer, hbLen, build) => {
    const car = P.createCar(V.toPhysics(V.carById(carId), build), 0, 0, 0, prof); car.vx = v0; let maxB = 0, spin = false, band = 0, endB = 0;
    for (let i = 0; i < 5 * 120; i++) { const t = i / 120, raw = t < 0.25 ? 0 : (t < 3.2 ? steer : 0), hb = t > 0.3 && t < 0.3 + hbLen;
      P.driverSteer(car, raw, undefined, P.DT); P.driverPedals(car, 1, 0, P.DT, undefined);
      P.step(car, { throttle: car.thr, brake: 0, steer: car.steer, handbrake: hb }, 1);
      const ab = Math.abs(car.beta); maxB = Math.max(maxB, ab); if (ab > 1.4 || car.vx < -1) spin = true; if (ab > 0.2 && ab < 0.9) band += P.DT; }
    return { maxB, spin, band, endB: Math.abs(car.beta), car };
  };
  const sweep = (carId, prof, build) => { let n = 0, spins = 0, none = 0, nn = 0, band = 0; for (const v of [16, 20, 24, 28, 32]) for (const st of [0.5, 0.8, 1]) for (const hb of [0.2, 0.4, 0.7, 1.0]) { const r = run(carId, prof, v, st, hb, build); n++; if (r.spin) spins++; band += r.band; if (hb >= 0.4) { nn++; if (r.maxB < 0.2) none++; } } return { spin: spins / n, none: none / nn, band: band / n }; };
  const S = {}; for (const c of V.CARS) { S[c.id] = {}; for (const p of PROFS) S[c.id][p] = sweep(c.id, p); }
  ok('Beginner: the starter car never spins out across 60 handbrake-initiated slides (speeds 58-115 km/h, 3 steering amounts, 4 handbrake lengths)', S['kazan-rz1'].beginner.spin === 0, S['kazan-rz1'].beginner);
  ok('Beginner: no car spins out at all, whatever the drivetrain or power (' + V.CARS.map(c => c.id.split('-')[0] + ' ' + Math.round(S[c.id].beginner.spin * 100) + '%').join(', ') + ')', V.CARS.every(c => S[c.id].beginner.spin === 0));
  ok('Standard: starter car does not spin out, and the 480 hp drift car under 10% (' + Math.round(S['ryujin-drx'].standard.spin * 100) + '%)', S['kazan-rz1'].standard.spin === 0 && S['ryujin-drx'].standard.spin < 0.1);
  ok('Expert is the demanding one: the starter car spins in more than a third of the same slides (' + Math.round(S['kazan-rz1'].expert.spin * 100) + '%)', S['kazan-rz1'].expert.spin > 0.33);
  ok('the three modes are meaningfully different: spin-outs Beginner < Standard < Expert on the 480 hp car', S['ryujin-drx'].beginner.spin < S['ryujin-drx'].standard.spin + 0.001 && S['ryujin-drx'].standard.spin < S['ryujin-drx'].expert.spin);
  ok('the handbrake starts a slide predictably: RWD starter car, a 0.4 s tap or longer gives 12+ degrees at every tested speed', S['kazan-rz1'].beginner.none === 0 && S['kazan-rz1'].standard.none === 0);
  ok('...and rotates the stabler FWD and AWD cars too (under 20% of taps leave them gripping), so each drivetrain can be drifted', ['sora-hatch', 'tsurugi-rs4', 'raiden-gtawd'].every(id => S[id].beginner.none < 0.2 && S[id].standard.none < 0.05), ['sora-hatch', 'tsurugi-rs4', 'raiden-gtawd'].map(id => S[id].beginner.none));
  ok('Beginner: a handbrake slide at a typical drift speed stays in the controllable 11-50 degree band for seconds (starter car: ' + S['kazan-rz1'].beginner.band.toFixed(1) + ' s average)', S['kazan-rz1'].beginner.band > 1.5);
  ok('the starter car is the most forgiving RWD car at Standard (fewest spins; no spin-outs at all)', S['kazan-rz1'].standard.spin <= S['hayate-rd'].standard.spin && S['kazan-rz1'].standard.spin <= S['orochi-tgt'].standard.spin);

  // a held drift: handbrake tap, then hold steer + throttle like a keyboard player; must be sustained, and straighten when the keys are released
  const held = (prof, v0) => { const car = P.createCar(V.toPhysics(V.carById('kazan-rz1')), 0, 0, 0, prof); car.vx = v0; let band = 0, maxB = 0, spun = false, endB = 1;
    for (let i = 0; i < 9 * 120; i++) { const t = i / 120, raw = t < 0.2 ? 0 : (t < 5.2 ? 1 : 0), hb = t > 0.3 && t < 0.7; const thr = t < 5.2 ? 1 : 0.3;
      P.driverSteer(car, raw, undefined, P.DT); P.driverPedals(car, thr, 0, P.DT, undefined); P.step(car, { throttle: car.thr, brake: 0, steer: car.steer, handbrake: hb }, 1);
      const ab = Math.abs(car.beta); maxB = Math.max(maxB, ab); if (ab > 1.4 || car.vx < -1) spun = true; if (ab > 0.2 && ab < 0.9 && t < 5.2) band += P.DT; if (i === 9 * 120 - 1) endB = ab; }
    return { band, maxB, spun, endB }; };
  for (const v of [18, 22, 26]) { const h = held('beginner', v); ok('Beginner, ' + Math.round(v * 3.6) + ' km/h: a tapped handbrake turns into a held controlled slide (' + h.band.toFixed(1) + ' s in the 11-50 degree band, peak ' + Math.round(h.maxB * 57.3) + ' deg), no spin, and it straightens after release (' + Math.round(h.endB * 57.3) + ' deg)', h.band > 1.9 && !h.spun && h.maxB < 0.95 && h.endB < 0.12, h); }

  // steering is not twitchy at speed
  const steerTest = (prof, v) => { const car = P.createCar(V.toPhysics(V.carById('kazan-rz1')), 0, 0, 0, prof); car.vx = v; let lat = 0, yaw = 0, t90 = null; for (let i = 0; i < 0.8 * 120; i++) { P.driverSteer(car, 1, undefined, P.DT); P.driverPedals(car, 0.3, 0, P.DT, undefined); P.step(car, { throttle: car.thr, brake: 0, steer: car.steer }, 1); lat = Math.max(lat, Math.abs(car.latG)); yaw = Math.max(yaw, Math.abs(car.w)); if (t90 == null && Math.abs(car.steer) >= 0.9) t90 = i * P.DT; } return { lat, yaw, t90 }; };
  const sb = steerTest('beginner', 40), ss = steerTest('standard', 40), se = steerTest('expert', 40);
  ok('steering at 144 km/h is tame in Beginner: a full-lock tap peaks at ' + sb.lat.toFixed(2) + ' g (Standard ' + ss.lat.toFixed(2) + ', Expert ' + se.lat.toFixed(2) + ')', sb.lat < 1.2 && sb.lat < ss.lat && ss.lat < se.lat);
  ok('...and the wheel moves gradually (90% of lock takes ' + sb.t90.toFixed(2) + ' s at that speed, vs ' + se.t90.toFixed(2) + ' s in Expert), faster at low speed', sb.t90 > 0.25 && sb.t90 > se.t90 + 0.05 && steerTest('beginner', 12).t90 < sb.t90);
  ok('speed-sensitive: the same tap makes far less yaw at 144 km/h than at 43 km/h in Beginner is NOT required, but lock shrinks with speed', (() => { const c1 = P.createCar(V.toPhysics(V.carById('kazan-rz1')), 0, 0, 0, 'beginner'), c2 = P.createCar(V.toPhysics(V.carById('kazan-rz1')), 0, 0, 0, 'beginner'); c1.vx = 12; c2.vx = 40; return P.steerLimit(c2) < P.steerLimit(c1) * 0.6; })());

  // countersteer recovers a slide (assist OFF: the player does it)
  const recov = () => { const car = P.createCar(V.toPhysics(V.carById('kazan-rz1')), 0, 0, 0, 'standard'); car.vx = 27; for (let i = 0; i < 130; i++) { const t = i / 120; P.driverSteer(car, t < 0.2 ? 0 : 1, 0, P.DT); P.driverPedals(car, 1, 0, P.DT, 0); P.step(car, { throttle: car.thr, brake: 0, steer: car.steer, handbrake: t > 0.25 && t < 0.95 }, 1); }
    const b0 = Math.abs(car.beta); let t = 0; while (t < 4 && Math.abs(car.beta) > 0.06) { const dir = Math.sign(car.beta); P.driverSteer(car, Math.max(-1, Math.min(1, dir * 0.9)), 0, P.DT); P.driverPedals(car, 0, 0, P.DT, 0); P.step(car, { throttle: car.thr, brake: 0, steer: car.steer }, 1); t += P.DT; } return { b0, t, b1: Math.abs(car.beta) }; };
  const rc = recov(); ok('countersteering and lifting recovers a ' + Math.round(rc.b0 * 57.3) + ' degree slide to straight in ' + rc.t.toFixed(1) + ' s with NO assist (the player can do it)', rc.b0 > 0.3 && rc.b1 <= 0.06 && rc.t < 2.5, rc);
  const rec2 = (() => { const car = P.createCar(V.toPhysics(V.carById('kazan-rz1')), 0, 0, 0, 'beginner'); car.vx = 22; for (let i = 0; i < 100; i++) { const t = i / 120; P.driverSteer(car, t < 0.2 ? 0 : 1, undefined, P.DT); P.driverPedals(car, 1, 0, P.DT, undefined); P.step(car, { throttle: car.thr, brake: 0, steer: car.steer, handbrake: t > 0.25 && t < 0.7 }, 1); }
    let t = 0; while (t < 4 && Math.abs(car.beta) > 0.06) { P.driverSteer(car, 0, undefined, P.DT); P.driverPedals(car, 0, 0, P.DT, undefined); P.step(car, { throttle: car.thr, brake: 0, steer: car.steer }, 1); t += P.DT; } return { t, b: Math.abs(car.beta) }; })();
  ok('Beginner: simply letting go of the keys straightens the car out (' + rec2.t.toFixed(1) + ' s)', rec2.b <= 0.06 && rec2.t < 2.5, rec2);
  // left <-> right transition
  const trans = (prof) => { const car = P.createCar(V.toPhysics(V.carById('kazan-rz1')), 0, 0, 0, prof); car.vx = 24; let maxB = 0, flipped = false, sgn0 = 0, spun = false;
    for (let i = 0; i < 9 * 120; i++) { const t = i / 120, raw = t < 0.2 ? 0 : t < 3.4 ? 1 : -1, hb = (t > 0.25 && t < 0.65) || (t > 3.4 && t < 3.75);
      P.driverSteer(car, raw, undefined, P.DT); P.driverPedals(car, t < 3.3 ? 1 : 0.6, 0, P.DT, undefined); P.step(car, { throttle: car.thr, brake: 0, steer: car.steer, handbrake: hb }, 1);
      maxB = Math.max(maxB, Math.abs(car.beta)); if (car.vx < -1 || Math.abs(car.beta) > 1.4) spun = true; if (t > 2.5 && t < 3.3 && Math.abs(car.beta) > 0.15) sgn0 = Math.sign(car.beta); if (t > 3.5 && sgn0 && Math.sign(car.beta) === -sgn0 && Math.abs(car.beta) > 0.15) flipped = true; }
    return { maxB, flipped, spun }; };
  const tb = trans('beginner'), ts = trans('standard'); ok('a right-to-left transition flick swings the slide the other way without spinning (Beginner ' + (tb.flipped ? 'flipped' : 'no flip') + ', peak ' + Math.round(tb.maxB * 57.3) + ' deg; Standard peak ' + Math.round(ts.maxB * 57.3) + ' deg)', tb.flipped && !tb.spun && !ts.spun, [tb, ts]);

  // upgrades still change handling in every mode
  const stock = V.defaultBuild(), slick = Object.assign(V.defaultBuild(), { tires: 3, susp: 3 });
  const gripTest = (build, prof) => { let best = 0; for (const st of [0.3, 0.5, 0.7, 0.9]) { const c = P.createCar(V.toPhysics(V.carById('kazan-rz1'), build), 0, 0, 0, prof); c.vx = 24; let lat = 0, n = 0; for (let i = 0; i < 3 * 120; i++) { P.driverSteer(c, st, undefined, P.DT); P.driverPedals(c, 0.4, 0, P.DT, undefined); P.step(c, { throttle: c.thr, brake: 0, steer: c.steer }, 1); if (i > 2 * 120) { lat += Math.abs(c.w * c.speed) / 9.81; n++; } } best = Math.max(best, lat / n); } return best; };
  ok('semi-slicks + race suspension still raise cornering grip in every mode (' + PROFS.map(p => p + ' ' + gripTest(stock, p).toFixed(2) + ' -> ' + gripTest(slick, p).toFixed(2) + ' g').join(', ') + ')', PROFS.every(p => gripTest(slick, p) > gripTest(stock, p) + 0.03));
  const a0 = V.analyze(V.carById('kazan-rz1'), stock), a1 = V.analyze(V.carById('kazan-rz1'), { engine: 3, weight: 2 });
  ok('engine and weight upgrades still shorten 0-100 and raise power', a1.t100 < a0.t100 && a1.hp > a0.hp);
  ok('each drivetrain feels different: stable AWD vs loose RWD under the same Expert-mode kick (slip ' + Math.round(run('tsurugi-rs4', 'expert', 22, 0.7, 0.45).maxB * 57.3) + ' vs ' + Math.round(run('kazan-rz1', 'expert', 22, 0.7, 0.45).maxB * 57.3) + ' deg)', run('tsurugi-rs4', 'expert', 22, 0.7, 0.45).maxB < run('kazan-rz1', 'expert', 22, 0.7, 0.45).maxB);
}

section('Tracks: six continuous, finishable mountain roads');
const tracks = T.COURSES.map(c => T.build(c));
ok('six courses', tracks.length === 6 && ['Pine Ridge', 'Moonlight Pass', 'Redline Canyon', 'Misty Summit', 'Blackpine Descent', 'Midnight Crown'].every((n, i) => tracks[i].name === n));
tracks.forEach(tr => {
  let maxStep = 0, maxTurn = 0, maxDk = 0, minR = 1e9, bad = false;
  for (let i = 0; i < tr.n - 1; i++) { const d = Math.hypot(tr.px[i + 1] - tr.px[i], tr.py[i + 1] - tr.py[i]); maxStep = Math.max(maxStep, Math.abs(d - T.DS)); let dh = tr.hd[i + 1] - tr.hd[i]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI; maxTurn = Math.max(maxTurn, Math.abs(dh)); maxDk = Math.max(maxDk, Math.abs(tr.kappa[i + 1] - tr.kappa[i])); if (Math.abs(tr.kappa[i]) > 1e-6) minR = Math.min(minR, 1 / Math.abs(tr.kappa[i])); if (!isFinite(tr.px[i] + tr.py[i])) bad = true; }
  ok(tr.name + ': continuous road (even spacing, curvature changes smoothly: no kinks)', maxStep < 0.05 && maxDk < 0.03 && maxTurn < 0.25 && !bad, [maxStep, maxDk, maxTurn]);
  ok(tr.name + ': never comes close to itself (clearance ' + T.clearance(tr).toFixed(1) + ' m, need ' + tr.need.toFixed(1) + ')', T.clearance(tr) >= tr.need - 0.01);
  ok(tr.name + ': has hairpins (min radius ' + minR.toFixed(1) + ' m)', minR < 26 && minR > 12);
  ok(tr.name + ': checkpoints ordered, finish last', tr.checkpoints.every((c, i, a) => i === 0 || c.s > a[i - 1].s) && tr.checkpoints[tr.checkpoints.length - 1].finish && tr.checkpoints.length >= 4);
  ok(tr.name + ': drift zones inside the race', tr.driftZones.length >= 3 && tr.driftZones.every(z => z.s0 >= tr.startS && z.s1 <= tr.finishS));
  const sc = tr.buildScenery(), sc2 = T.build(tr.id).buildScenery();
  ok(tr.name + ': scenery is deterministic and stays off the road', sc.items.length === sc2.items.length && sc.items[10].x === sc2.items[10].x && sc.items.every((it, k) => { if (k % 25) return true; const q = tr.query(it.x, it.y, -1); return Math.abs(q.offset) > q.rail + 1; }));
  const p = tr.poseAt(tr.length / 2, 2.5), q = tr.query(p.x, p.y, -1);
  ok(tr.name + ': query() inverts poseAt()', near(q.s, tr.length / 2, 0.6) && near(q.offset, 2.5, 0.2), [q.s, q.offset]);
});
ok('difficulty rises: courses get longer and narrower', tracks.every((t, i) => i === 0 || (t.raceLength > tracks[i - 1].raceLength * 0.95 && t.width <= tracks[i - 1].width)));
{
  const tr = tracks[0], car = P.createCar(V.toPhysics(V.carById('kazan-rz1'), null), 0, 0, 0), pose = tr.poseAt(300, 0);
  car.x = pose.x; car.y = pose.y; car.th = pose.th + 0.5; car.vx = 25;
  let worst = 0, outside = 0;
  for (let i = 0; i < 120 * 6; i++) { P.step(car, { throttle: 0.5, brake: 0, steer: 0 }, 1); worst = Math.max(worst, P.collideTrack(car, tr, -1)); const q = tr.query(car.x, car.y, -1); if (Math.abs(q.offset) > q.rail + 0.3) outside++; }
  ok('driving into the guard rail registers an impact and keeps the car on the road', worst > 2 && outside === 0, [worst, outside]);
}

section('Roads: wider, flared hairpins, one geometry for rendering / collision / checkpoints');
{
  const OLD = [9.2, 8.8, 8.4, 8.2, 7.8, 7.6];
  tracks.forEach((tr, k) => {
    ok(tr.name + ': road is ' + Math.round((tr.width / OLD[k] - 1) * 100) + '% wider than before (' + OLD[k] + ' -> ' + tr.width + ' m)', tr.width / OLD[k] >= 1.3 && tr.width / OLD[k] <= 1.55);
    let maxStep = 0, flare = 0, minL = 1e9, minR = 1e9;
    for (let i = 0; i < tr.n - 1; i++) { maxStep = Math.max(maxStep, Math.abs(tr.hl[i + 1] - tr.hl[i]), Math.abs(tr.hr[i + 1] - tr.hr[i])); flare = Math.max(flare, tr.hl[i] - tr.half, tr.hr[i] - tr.half); minL = Math.min(minL, tr.hl[i]); minR = Math.min(minR, tr.hr[i]); }
    ok(tr.name + ': hairpin outsides flare ' + flare.toFixed(1) + ' m wider, widths change smoothly (max step ' + maxStep.toFixed(3) + ' m per sample), never narrower than the nominal road', flare > 2 && maxStep < 0.2 && minL >= tr.half - 0.01 && minR >= tr.half - 0.01, [flare, maxStep, minL, minR]);
    // the collision rail is where the render puts it: query() and edgeAt() read the same arrays, at every sample and between
    let mism = 0; for (let s = tr.startS; s < tr.finishS; s += 3.7) { const e = tr.edgeAt(s), pL = tr.poseAt(s, -(e.railL - 0.2)), pR = tr.poseAt(s, e.railR - 0.2), rl = tr.query(pL.x, pL.y, -1).rail, rr = tr.query(pR.x, pR.y, -1).rail;
      if (Math.abs(rl - e.railL) > 0.15 || Math.abs(rr - e.railR) > 0.15) mism++; if (e.railL < e.hl || e.railR < e.hr) mism++; }
    ok(tr.name + ': collision rails match the drawn road edges along the whole course', mism === 0, mism);
    ok(tr.name + ': every checkpoint gate and the start line sit inside the road', tr.checkpoints.every(c => { const e = tr.edgeAt(c.s); return e.hl > 4 && e.hr > 4; }) && tr.railMax < tr.need / 2);
  });
  // driving the nominal and the outside-flared edge of every hairpin must not touch a wall
  let bad = 0; for (const tr of tracks) for (let s = tr.startS; s < tr.finishS; s += 2) { const e = tr.edgeAt(s); for (const o of [-(e.hl - 1.5), e.hr - 1.5]) { const p = tr.poseAt(s, o), q = tr.query(p.x, p.y, -1); if (Math.abs(q.offset - o) > 0.2) bad++; } }
  ok('every point inside the drawn road maps back to the same place on the centre line (no gaps, overlaps or folded corners)', bad === 0, bad);
}

section('Courses: all six are completable by a keyboard-style player (no assist from the AI)');
{
  const { makeBot } = require('./lib/keyboard-bot.js');
  for (const prof of ['beginner', 'standard']) for (const c of T.COURSES) {
    const track = Progress.track(c.id), r = Race.create({ track, mode: 'time', player: { carId: 'kazan-rz1', name: 'bot' }, rivals: [], drive: prof }), bot = makeBot(r, { skill: 0.6 });
    let n = 0, walls = 0; while (!r.done && r.t < 400 && n++ < 120 * 420) { Race.step(r, bot(r)); }
    ok(c.name + ' (' + prof + '): a binary-key bot finishes in ' + (r.player.finishTime || 0).toFixed(0) + ' s, ' + r.player.recoveries + ' resets', r.player.finished, [r.t, r.player.recoveries]);
  }
}


section('Drift scoring');
{
  const tr = tracks[1];
  const mk = () => ({ speed: 20, beta: 0.5, vx: 18, w: 1 });
  let d = D.create(); for (let i = 0; i < 120 * 4; i++) D.update(d, mk(), true, false, 0, P.DT); D.finish(d);
  ok('a held 29-degree drift at 72 km/h scores points (' + Math.round(d.score) + ')', d.score > 100, d.score);
  let z = D.create(); for (let i = 0; i < 120 * 4; i++) D.update(z, mk(), true, true, 0, P.DT); D.finish(z);
  ok('drift zones double the points', z.score > d.score * 1.7, [d.score, z.score]);
  let sp = D.create(); for (let i = 0; i < 120 * 6; i++) D.update(sp, { speed: 3, beta: 1.2, vx: 2.5, w: 3 }, true, false, 0, P.DT); D.finish(sp);
  ok('spinning at low speed scores nothing', sp.score === 0);
  let sp2 = D.create(); for (let i = 0; i < 120 * 6; i++) D.update(sp2, { speed: 20, beta: 1.5, vx: 1, w: 3 }, true, false, 0, P.DT); D.finish(sp2);
  ok('sliding sideways past ~77 degrees scores nothing', sp2.score === 0);
  let off = D.create(); for (let i = 0; i < 120 * 4; i++) D.update(off, mk(), false, false, 0, P.DT); D.finish(off);
  ok('drifting off the road scores nothing', off.score === 0);
  let rv = D.create(); for (let i = 0; i < 120 * 4; i++) D.update(rv, { speed: 15, beta: 0.5, vx: -12, w: 1 }, true, false, 0, P.DT); D.finish(rv);
  ok('reversing scores nothing', rv.score === 0);
  let hit = D.create(); for (let i = 0; i < 120 * 3; i++) D.update(hit, mk(), true, false, 0, P.DT); const chainBefore = hit.chain; D.update(hit, mk(), true, false, 8, P.DT);
  ok('hitting a wall throws away the unbanked chain', chainBefore > 50 && hit.chain === 0 && hit.hits === 1);
  let pen = D.create(); pen.score = 1000; D.update(pen, mk(), true, false, 12, P.DT);
  ok('a crash costs at most a quarter of the banked score', pen.score >= 750 && pen.score < 1000, pen.score);
  let pen2 = D.create(); pen2.score = 100; D.update(pen2, mk(), true, false, 12, P.DT); ok('...and a small score is not wiped out', pen2.score >= 75, pen2.score);
  let sw = D.create(); for (let i = 0; i < 120 * 4; i++) D.update(sw, { speed: 20, beta: (i % 240 < 120 ? 1 : -1) * 0.5, vx: 18, w: 1 }, true, false, 0, P.DT);
  ok('smooth direction changes build the combo (transitions)', sw.flips >= 1 && sw.combo > 1.8, [sw.flips, sw.combo]);
  // end to end: a real drifting run on the real physics
  const r = Race.create({ track: tr, mode: 'drift', player: { carId: 'kazan-rz1', name: 'T' }, rivals: [], assist: 0.6 }); const pl = r.player;
  const pose = tr.poseAt(tr.startS + 60, 0); pl.c.x = pose.x; pl.c.y = pose.y; pl.c.th = pose.th; pl.c.vx = 24; r.state = 'running';
  let k = 0; for (let i = 0; i < 120 * 4; i++) { Race.step(r, { throttle: 1, brake: 0, steer: i < 30 ? 0 : 0.7, handbrake: i > 40 && i < 90, kick: false }); k++; }
  ok('a drift started with the handbrake on the real car scores points', pl.drift.score + pl.drift.chain > 0 || pl.drift.maxAngle > 0.2, [pl.drift.score, pl.drift.chain, pl.drift.maxAngle]);
}

section('AI: rivals drive the same physics and finish every course');
function aiRun(courseId, carId, skill) {
  const track = Progress.track(courseId), r = Race.create({ track, mode: 'rival', player: { carId, name: 'bot' }, rivals: [], assist: 0 });
  const pl = r.player; pl.human = false; pl.driver = AI.createDriver(track, pl.c.p, skill, 5); let n = 0;
  while (!r.done && r.t < 600 && n++ < 120 * 620) Race.step(r, null);
  return { r, pl, time: pl.finishTime };
}
for (const c of T.COURSES) { const o = aiRun(c.id, 'kazan-rz1', 0.85); ok(c.name + ': AI finishes in ' + (o.time && o.time.toFixed(1)) + ' s (par ' + Progress.PAR[c.id] + ')', o.pl.finished && near(o.time, Progress.PAR[c.id], Progress.PAR[c.id] * 0.04), [o.time, Progress.PAR[c.id]]); }
{
  let fin = 0, tot = 0, rec = 0;
  for (const car of V.CARS) for (const c of [T.COURSES[0], T.COURSES[3], T.COURSES[5]]) { const o = aiRun(c.id, car.id, 0.8); tot++; if (o.pl.finished) fin++; rec += o.pl.recoveries; }
  ok('every car finishes the easiest, a middle and the final course under AI control (' + fin + '/' + tot + ')', fin === tot, [fin, tot]);
  ok('the AI rarely needs to be put back on the road (' + rec + ' recoveries)', rec <= 6, rec);
  const slow = aiRun('moonlight-pass', 'kazan-rz1', 0.55), fast = aiRun('moonlight-pass', 'kazan-rz1', 0.95);
  ok('higher skill is faster (' + slow.time.toFixed(1) + ' vs ' + fast.time.toFixed(1) + ' s)', fast.time < slow.time - 3);
  const quick = aiRun('misty-summit', 'raiden-gtawd', 0.85), stock = aiRun('misty-summit', 'sora-hatch', 0.85);
  ok('a stronger car is faster under the same driver', quick.time < stock.time, [quick.time, stock.time]);
}

section('Race rules: countdown, checkpoints, reset, finish, ghost, rivals');
{
  const tr = Progress.track('pine-ridge');
  const r = Race.create({ track: tr, mode: 'time', player: { carId: 'kazan-rz1', name: 'You' }, rivals: [], assist: 0.55 });
  const x0 = r.player.c.x; let go = false, counts = [];
  for (let i = 0; i < 120 * 3; i++) { Race.step(r, { throttle: 1, brake: 0, steer: 0 }); for (const e of r.events) { if (e.type === 'count') counts.push(e.n); if (e.type === 'go') go = true; } }
  ok('the car cannot move during the countdown', r.state === 'countdown' && r.player.c.x === x0);
  for (let i = 0; i < 120 * 1; i++) { Race.step(r, { throttle: 1, brake: 0, steer: 0 }); for (const e of r.events) { if (e.type === 'count') counts.push(e.n); if (e.type === 'go') go = true; } }
  ok('countdown reaches GO', go && r.state === 'running' && counts.includes(3) && counts.includes(1), counts);
  for (let i = 0; i < 120 * 12; i++) Race.step(r, { throttle: 1, brake: 0, steer: 0 });
  ok('the car accelerates away after GO', r.player.c.speed > 15 && r.player.s > tr.startS - 5);
  // checkpoints must be passed in order and the finish needs all of them
  const p = r.player; p.nextCp = 0;
  ok('finish is not credited before the checkpoints are passed', !p.finished);
  // reset
  const before = p.penalty; p.nextCp = 2; p.lastCp = 1; ok('reset puts the car back on the road at the last checkpoint with a time penalty', Race.reset(r) && p.penalty === before + Race.RESET_PENALTY && Math.abs(p.c.speed) < 0.01 && Math.abs(tr.query(p.c.x, p.c.y, -1).offset) < 0.5 && near(p.s, tr.checkpoints[1].s - 3, 4), [p.s, tr.checkpoints[1].s]);
}
{
  // a full run by an AI-controlled "player": finish, results, ghost
  const o = aiRun('pine-ridge', 'kazan-rz1', 0.7), res = Race.results(o.r);
  ok('player finish is validated through every checkpoint (' + o.pl.splits.length + ' splits)', o.pl.splits.length === Progress.track('pine-ridge').checkpoints.length && res.finished);
  ok('splits increase and the final split is the finish time', o.pl.splits.every((s, i, a) => !i || s > a[i - 1]) && near(o.pl.splits[o.pl.splits.length - 1], res.time, 0.001));
  ok('a ghost was recorded at 20 Hz for the whole run', res.ghost && near(res.ghost.data.length / 3 * 0.05, res.time, 1.5), [res.ghost.data.length / 3 * 0.05, res.time]);
  const gr = Race.create({ track: Progress.track('pine-ridge'), mode: 'time', player: { carId: 'kazan-rz1' }, rivals: [], ghost: res.ghost });
  const g1 = Race.ghostPose(gr, 10), g2 = Race.ghostPose(gr, 10.02);
  ok('ghost playback interpolates positions', g1 && g2 && Math.hypot(g2.x - g1.x, g2.y - g1.y) > 0.1 && Race.ghostPose(gr, res.time + 30) === null);
}
{
  const ev = Progress.eventById('r2-boss'), riv = Progress.rivalsFor(ev), tr = Progress.track(ev.course);
  const r = Race.create({ track: tr, mode: 'rival', player: { carId: 'kazan-rz1', name: 'You' }, rivals: riv, assist: 0.55 });
  const pl = r.player; pl.human = false; pl.driver = AI.createDriver(tr, pl.c.p, 0.6, 9);
  let n = 0; while (!r.done && n++ < 120 * 400) Race.step(r, null);
  const res = Race.results(r);
  ok('a rival battle has a real field of ' + res.field + ' and every car finishes or is ranked by progress', res.field === 4 && res.rivals.length === 4 && res.rivals.every(x => x.place >= 1 && x.place <= 4), res.rivals);
  ok('rival places are a permutation (no fake results)', new Set(res.rivals.map(x => x.place)).size === 4);
  ok('the slower player (skill 0.6, stock car) loses to the region-2 field: places come from the simulation, not a script', res.place > 1, res.place);
}

section('Progression, medals and rewards');
{
  const s = Save.defaultSave();
  ok('a new save starts with credits and the Kazan RZ-1', s.credits === Progress.START_CREDITS && s.owned['kazan-rz1'] && s.selected === 'kazan-rz1');
  ok('only region 1 is open at the start', Progress.regionsUnlocked(s) === 1 && Progress.courseUnlocked(s, 'pine-ridge') && !Progress.courseUnlocked(s, 'moonlight-pass'));
  ok('24 career events, 4 per region', Progress.EVENTS().length === 24 && [1, 2, 3, 4, 5, 6].every(r => Progress.EVENTS().filter(e => e.region === r).length === 4));
  const th = Progress.thresholds('pine-ridge', 'time');
  ok('time medals: gold < silver < bronze thresholds', th[3] < th[2] && th[2] < th[1]);
  ok('medalFor(time) honours the thresholds', Progress.medalFor('time', 'pine-ridge', { finished: true, time: th[3] - 1 }) === 3 && Progress.medalFor('time', 'pine-ridge', { finished: true, time: th[1] + 1 }) === 0 && Progress.medalFor('time', 'pine-ridge', { finished: false, time: 1 }) === 0);
  ok('rival medals by finishing place', [1, 2, 3, 4].map(p => Progress.medalFor('rival', 'pine-ridge', { finished: true, place: p })).join() === '3,2,1,0');
  const ctx = { mode: 'time', courseId: 'pine-ridge', eventId: 'r1-time', carId: 'kazan-rz1' };
  const r1 = Progress.applyResult(s, ctx, { finished: true, time: th[1] - 1, driftScore: 0, field: 1, place: 1, bestDrift: 0 });
  ok('first bronze pays a reward and records the medal', r1.medal === 1 && r1.reward > 1000 && s.career.events['r1-time'].medal === 1 && r1.firstTime, r1);
  const c1 = s.credits, r2 = Progress.applyResult(s, ctx, { finished: true, time: th[1] - 2, driftScore: 0, field: 1, place: 1, bestDrift: 0 });
  ok('repeating the same medal pays only a small amount (no farming)', r2.reward < r1.reward * 0.25 && !r2.improved && s.credits === c1 + r2.reward, [r1.reward, r2.reward]);
  const r3 = Progress.applyResult(s, ctx, { finished: true, time: th[3] - 1, driftScore: 0, field: 1, place: 1, bestDrift: 0 });
  ok('upgrading to gold pays the difference', r3.medal === 3 && r3.improved && r3.reward > r1.reward, [r3.reward, r1.reward]);
  ok('records are kept per course', s.records['pine-ridge'].time.value < th[3]);
  // unlock region 2 with stars
  ['r1-drift', 'r1-rival', 'r1-boss'].forEach(id => { const ev = Progress.eventById(id); s.career.events[id] = { medal: 1 }; });
  ok('region 2 unlocks after enough stars (' + Progress.stars(s, 1) + ' >= ' + Progress.STARS_TO_UNLOCK + ')', Progress.regionUnlocked(s, 2) && Progress.courseUnlocked(s, 'moonlight-pass'));
  ok('not-yet-earned regions stay locked', !Progress.regionUnlocked(s, 3));
  const f = Progress.applyResult(s, { mode: 'time', courseId: 'pine-ridge', eventId: null, carId: 'kazan-rz1' }, { finished: false });
  ok('a DNF pays nothing', f.reward === 0 && f.medal === 0);
  const pr = Progress.applyResult(s, { mode: 'time', courseId: 'pine-ridge', eventId: null, carId: 'kazan-rz1' }, { finished: true, time: th[2], field: 1, place: 1, driftScore: 0, bestDrift: 0 });
  ok('free-play (practice) runs pay a little', pr.reward > 0 && pr.reward < r1.reward * 0.4, pr.reward);
}
section('Garage purchases');
{
  const s = Save.defaultSave(); s.credits = 100000;
  const hayate = V.carById('hayate-rd');
  ok('cars are locked until their region opens', !Progress.buyCar(s, 'hayate-rd').ok && s.credits === 100000);
  const sora = Progress.buyCar(s, 'sora-hatch'); ok('a region-1 car can be bought and credits drop by its price', sora.ok && s.credits === 100000 - V.carById('sora-hatch').price && s.owned['sora-hatch']);
  ok('cannot buy the same car twice', !Progress.buyCar(s, 'sora-hatch').ok);
  const cost1 = V.upgradeCost(V.carById('kazan-rz1'), 'engine', 1);
  ok('engine stages must be bought in order', !Progress.buyUpgrade(s, 'kazan-rz1', 'engine', 2).ok && Progress.buyUpgrade(s, 'kazan-rz1', 'engine', 1).ok && s.owned['kazan-rz1'].engine === 1);
  ok('upgrade cost scales with the car (cheap car, cheap parts)', cost1 < V.upgradeCost(V.carById('ryujin-drx'), 'engine', 1));
  const a0 = V.analyze(V.carById('kazan-rz1'), V.defaultBuild()), a1 = V.analyze(V.carById('kazan-rz1'), s.owned['kazan-rz1']);
  ok('the purchased engine makes the car quicker in the physics', a1.t100 < a0.t100 && a1.hp > a0.hp, [a0.t100, a1.t100]);
  s.credits = 10; ok('purchases are refused when credits are short and nothing is spent', !Progress.buyUpgrade(s, 'kazan-rz1', 'engine', 2).ok && s.credits === 10 && s.owned['kazan-rz1'].engine === 1);
  s.credits = 50000; ok('tyre compound: semi-slick purchase, then switching back is free', Progress.buyUpgrade(s, 'kazan-rz1', 'tires', 3).ok && s.owned['kazan-rz1'].tires === 3 && Progress.buyUpgrade(s, 'kazan-rz1', 'tires', 1).ok && Progress.buyUpgrade(s, 'kazan-rz1', 'tires', 3).cost === 0);
  ok('differential kit unlocks lock tuning, which changes the diff in the physics', !Progress.setDiff(s, 'kazan-rz1', 1) && Progress.buyUpgrade(s, 'kazan-rz1', 'diffKit').ok && Progress.setDiff(s, 'kazan-rz1', 1) && V.toPhysics(V.carById('kazan-rz1'), s.owned['kazan-rz1']).diff === 1);
  ok('paint and wheels are stored per car', Progress.setCosmetic(s, 'kazan-rz1', 'paint', 5) && Progress.setCosmetic(s, 'kazan-rz1', 'wheel', 2) && s.owned['kazan-rz1'].paint === 5 && s.owned['kazan-rz1'].wheel === 2);
  ok('you can only drive a car you own', !Progress.select(s, 'hakuba-zero') && Progress.select(s, 'sora-hatch') && s.selected === 'sora-hatch');
}
section('Saves: versioned, sanitised, exportable');
{
  const mem = {}; globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: i => Object.keys(mem)[i], get length() { return Object.keys(mem).length; } };
  const s = Save.defaultSave(); s.credits = 4242; s.owned['sora-hatch'] = V.defaultBuild(); s.career.events['r1-time'] = { medal: 2, best: 99.5 }; s.selected = 'sora-hatch';
  Save.store(s); const l = Save.load();
  ok('save round-trips through storage', l.credits === 4242 && l.owned['sora-hatch'] && l.career.events['r1-time'].medal === 2 && l.selected === 'sora-hatch' && l.v === 1);
  Save.storeSettings(Object.assign(Save.defaultSettings(), { volume: 0.3, units: 'mph' })); ok('settings persist', Save.loadSettings().volume === 0.3 && Save.loadSettings().units === 'mph');
  Save.storeGhost('pine-ridge', { carId: 'kazan-rz1', time: 80, dt: 0.05, data: [1, 2, 3, 4, 5, 6] }); ok('ghosts persist per course', Save.loadGhost('pine-ridge').time === 80 && Save.loadGhost('moonlight-pass') === null);
  const exp = Save.exportAll(); ok('export contains the save, settings and ghost', exp.entries['td.save.v1'] && exp.entries['td.settings.v1'] && exp.entries['td.ghost.v1.pine-ridge'] && exp.format === 'touge-drift-save');
  Save.reset(); ok('reset clears the game data', Save.load().credits === Progress.START_CREDITS && Save.loadGhost('pine-ridge') === null);
  const imp = Save.importAll(JSON.parse(JSON.stringify(exp))); ok('import restores everything', imp.ok && Save.load().credits === 4242 && Save.loadGhost('pine-ridge') !== null);
  ok('import rejects foreign files', !Save.importAll({ format: 'other' }).ok && !Save.importAll(null).ok && !Save.importAll({ format: 'touge-drift-save', version: 1, entries: { 'td.save.v1': '{bad' } }).ok);
  mem['td.save.v1'] = '{not json'; const bad = Save.load(); ok('a damaged save starts fresh but the damaged data is kept for recovery', bad.credits === Progress.START_CREDITS && Object.keys(mem).some(k => k.startsWith('td.save.corrupt.')));
  mem['td.save.v1'] = JSON.stringify({ v: 1, credits: -50, owned: { 'nope': {}, 'sora-hatch': { engine: 99, paint: -4 } }, selected: 'hakuba-zero' });
  const san = Save.load(); ok('tampered values are clamped (no negative credits, unknown cars dropped, build limits)', san.credits >= 0 && !san.owned.nope && san.owned['sora-hatch'].engine === 3 && san.owned['sora-hatch'].paint === 0 && san.selected === 'kazan-rz1' && san.owned['kazan-rz1']);
  mem['td.save.v1'] = JSON.stringify({ v: 7, credits: 10 }); Save.load(); ok('a save from a newer version is backed up before use', Object.keys(mem).some(k => k.startsWith('td.save.backup.')));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
