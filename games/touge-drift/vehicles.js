/* Touge Drift - the eight cars, upgrade maths and the stats shown in the garage. Pure data + functions (no DOM).
 * All cars are fictional. toPhysics(car, build) turns a car + its upgrades into the parameter set physics.js runs on,
 * so every upgrade changes real driving behaviour (power, mass, grip, slip response, diff). */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const P = () => TD.Physics;
  const HP = 745.7, KMH = 1 / 3.6;

  /* unlock: { region: n } = the n-th career region must be unlocked (n = 1 is available from the start). */
  const CARS = [
    { id: 'kazan-rz1', name: 'Kazan RZ-1', cls: 'Lightweight RWD Coupe', drive: 'RWD', hp: 200, kg: 1050, wf: 0.53, L: 2.43, top: 215, mu: 1.04, slideR: 0.88, alpha: 0.152, diff: 0.35, price: 0, unlock: { region: 1 },
      blurb: 'Light, honest and forgiving. The perfect first dance partner.', len: 4.2, wid: 1.76, nose: 0.5, tail: 0.35, cab: [0.34, 0.74], roof: 'closed', spoiler: 'lip', hood: 0.32 },
    { id: 'sora-hatch', name: 'Sora Hatch S', cls: 'Compact FWD Hatchback', drive: 'FWD', hp: 150, kg: 990, wf: 0.62, L: 2.5, top: 200, mu: 1.1, slideR: 0.9, alpha: 0.155, diff: 0.1, price: 7000, unlock: { region: 1 },
      blurb: 'Front-wheel drive, tidy and quick on corner exit. Slides need a lift or the handbrake.', len: 3.95, wid: 1.72, nose: 0.4, tail: 0.15, cab: [0.3, 0.86], roof: 'closed', spoiler: 'none', hood: 0.28 },
    { id: 'hayate-rd', name: 'Hayate Roadster', cls: 'RWD Roadster', drive: 'RWD', hp: 175, kg: 940, wf: 0.5, L: 2.31, top: 208, mu: 1.03, slideR: 0.8, alpha: 0.14, diff: 0.2, price: 16000, unlock: { region: 2 },
      blurb: 'Open-top and quick to rotate. Short wheelbase, so sharp reactions and no room for sloppy hands.', len: 3.95, wid: 1.7, nose: 0.55, tail: 0.5, cab: [0.42, 0.62], roof: 'open', spoiler: 'none', hood: 0.38 },
    { id: 'tsurugi-rs4', name: 'Tsurugi RS-4', cls: 'AWD Rally Sedan', drive: 'AWD', hp: 295, kg: 1380, wf: 0.57, L: 2.63, top: 238, mu: 1.12, slideR: 0.88, alpha: 0.16, diff: 0.4, price: 27000, unlock: { region: 2 },
      blurb: 'Rally-bred and planted. Four driven wheels pull it out of every slide, and it still dances when you ask.', len: 4.5, wid: 1.8, nose: 0.3, tail: 0.18, cab: [0.3, 0.8], roof: 'closed', spoiler: 'wing', hood: 0.3 },
    { id: 'orochi-tgt', name: 'Orochi T-GT', cls: 'Turbo RWD Coupe', drive: 'RWD', hp: 330, kg: 1290, wf: 0.54, L: 2.56, top: 252, mu: 1.07, slideR: 0.8, alpha: 0.15, diff: 0.3, price: 33000, unlock: { region: 3 },
      blurb: 'The turbo hits like a shove in the back. Free-flowing slides if you respect the boost.', len: 4.4, wid: 1.8, nose: 0.55, tail: 0.3, cab: [0.36, 0.72], roof: 'closed', spoiler: 'duck', hood: 0.36 },
    { id: 'ryujin-drx', name: 'Ryujin DR-X', cls: 'High-Power Drift Coupe', drive: 'RWD', hp: 480, kg: 1340, wf: 0.53, L: 2.65, top: 272, mu: 1.0, slideR: 0.9, alpha: 0.17, diff: 0.65, price: 62000, unlock: { region: 4 },
      blurb: 'Built to slide. Huge power, a locking diff and a long wheelbase that holds an angle.', len: 4.55, wid: 1.84, nose: 0.6, tail: 0.28, cab: [0.34, 0.68], roof: 'closed', spoiler: 'wing', hood: 0.4 },
    { id: 'raiden-gtawd', name: 'Raiden GT-AWD', cls: 'AWD Performance Coupe', drive: 'AWD', hp: 425, kg: 1520, wf: 0.55, L: 2.69, top: 276, mu: 1.19, slideR: 0.86, alpha: 0.155, diff: 0.5, price: 78000, unlock: { region: 5 },
      blurb: 'Brutally quick everywhere. A heavy, grippy car that drifts with power rather than finesse.', len: 4.65, wid: 1.88, nose: 0.45, tail: 0.25, cab: [0.33, 0.72], roof: 'closed', spoiler: 'duck', hood: 0.38 },
    { id: 'hakuba-zero', name: 'Hakuba Zero', cls: 'Lightweight Track Special', drive: 'RWD', hp: 365, kg: 860, wf: 0.47, L: 2.4, top: 288, mu: 1.28, slideR: 0.74, alpha: 0.125, diff: 0.55, price: 105000, unlock: { region: 6 },
      blurb: 'Almost no car around the engine. Savage grip, savage speed. Rewards precision, punishes mistakes.', len: 4.1, wid: 1.86, nose: 0.65, tail: 0.5, cab: [0.45, 0.7], roof: 'open', spoiler: 'wing', hood: 0.45 },
  ];
  const carById = id => CARS.find(c => c.id === id);

  /* Tyre compounds: grip multiplier, how much grip is left once sliding, how fast it falls off past the peak. */
  const COMPOUNDS = [
    { id: 'comfort', name: 'Comfort', mu: 0.94, slide: +0.05, fall: 0.8, cost: 0, blurb: 'Soft sidewalls and a gentle breakaway. Easy to hold a slide.' },
    { id: 'street', name: 'Street', mu: 1.0, slide: 0, fall: 1, cost: 0, blurb: 'Stock tyres.' },
    { id: 'sport', name: 'Sport', mu: 1.09, slide: -0.01, fall: 1.15, cost: 2200, blurb: 'More grip, a sharper edge.' },
    { id: 'slick', name: 'Semi-slick', mu: 1.18, slide: -0.04, fall: 1.4, cost: 5200, blurb: 'Huge grip but a sudden breakaway.' },
  ];
  const ENGINE = [1, 1.08, 1.17, 1.28], ENGINE_TOP = [1, 1.012, 1.025, 1.04];
  const SUSP_ALPHA = [1, 0.95, 0.9, 0.86], SUSP_MU = [1, 1.02, 1.04, 1.055];
  const WEIGHT = [1, 0.965, 0.93, 0.89];
  const BASE_COST = { engine: [0, 2800, 6500, 13000], susp: [0, 2200, 5200, 10000], weight: [0, 2500, 6000, 12000], diffKit: 3200 };
  const STAGE_NAMES = { engine: ['Stock', 'Stage 1', 'Stage 2', 'Stage 3'], susp: ['Stock', 'Sport', 'Coilover', 'Race'], weight: ['Stock', 'Light', 'Lighter', 'Stripped'] };
  const PAINTS = ['#e8e4da', '#161619', '#c4231c', '#e8761d', '#f0c230', '#2f9e5b', '#1c6fd1', '#27d1c8', '#6a3fb0', '#e65a9a', '#8a929c', '#1a2a63'];
  const WHEELS = [{ id: 'five', name: 'Five-spoke' }, { id: 'mesh', name: 'Mesh' }, { id: 'turbine', name: 'Turbine' }, { id: 'steel', name: 'Steelie' }];
  const WHEEL_COLORS = ['#c9ccd2', '#16161a', '#e8b84a', '#c4231c', '#e8e4da', '#3a7bd5'];

  const defaultBuild = () => ({ engine: 0, susp: 0, tires: 1, diffKit: false, diffLock: null, weight: 0, paint: 0, wheel: 0, wheelColor: 0 });
  const carFactor = car => Math.max(0.45, Math.pow(Math.max(car.price, 12000) / 30000, 0.6));
  const upgradeCost = (car, kind, stage) => Math.round(((kind === 'tires' ? COMPOUNDS[stage].cost : kind === 'diffKit' ? BASE_COST.diffKit : BASE_COST[kind][stage]) * (kind === 'tires' ? 1 : carFactor(car))) / 50) * 50;

  /** Build the physics parameter set for a car with the given upgrades. */
  function toPhysics(car, build) {
    build = Object.assign(defaultBuild(), build || {});
    const comp = COMPOUNDS[build.tires] || COMPOUNDS[1];
    const mass = car.kg * WEIGHT[build.weight];
    const power = car.hp * HP * 0.82 * ENGINE[build.engine];
    const top = car.top * KMH * ENGINE_TOP[build.engine];
    const L = car.L, alphaMul = SUSP_ALPHA[build.susp];
    const muBase = car.mu * SUSP_MU[build.susp] * comp.mu;
    const rearBias = car.drive === 'FWD' ? 0.97 : car.drive === 'RWD' ? 0.99 : 1;
    const diff = build.diffKit && build.diffLock != null ? build.diffLock : car.diff;
    const iz = 0.22 * mass * L * L;
    return {
      id: car.id, drive: car.drive, mass, L, wf: car.wf, hCg: 0.5, iz,
      power, fPeak: power / 11.5, topSpeed: top, kDrag: power * 0.9 / (top * top * top), kDragY: 3.2 * mass / 1000,
      brakeG: 1.02 * Math.min(1.12, 0.92 + (muBase - 1) * 0.6 + 0.12), muF: muBase * (car.drive === 'FWD' ? 1.0 : 1.02), muR: muBase * rearBias,
      alphaF: car.alpha * alphaMul, alphaR: car.alpha * alphaMul * 1.05,
      slideF: clamp01(car.slideR - 0.06 + comp.slide), slideR: clamp01(car.slideR + comp.slide), fallF: 1.5 * comp.fall, fallR: 1.7 * comp.fall,
      diff, steerMax: 0.62, steerVRef: 30, yawDamp: iz * 0.65,
      gearTops: [0.17, 0.3, 0.44, 0.6, 0.79, 1.0].map(f => f * top * 1.02),
      hl: car.len / 2, hw: car.wid / 2,
    };
  }
  const clamp01 = v => Math.max(0.5, Math.min(0.97, v));

  /* ---- stats (cached): measured from the same physics where possible ---- */
  const cache = {};
  function measureAccel(p) {
    const car = P().createCar(p, 0, 0, 0); let t = 0, t100 = null, t60 = null;
    for (let i = 0; i < 120 * 25; i++) {
      P().step(car, { throttle: 1, brake: 0, steer: 0 }, 1); t += P().DT;
      if (t60 == null && car.vx >= 60 * KMH) t60 = t;
      if (car.vx >= 100 * KMH) { t100 = t; break; }
    }
    return t100 == null ? 25 : t100;
  }
  function measureBrake(p) {                      // metres to stop from 100 km/h
    const car = P().createCar(p, 0, 0, 0); car.vx = 100 * KMH; let d = 0;
    for (let i = 0; i < 120 * 12 && car.vx > 0.5; i++) { P().step(car, { throttle: 0, brake: 1, steer: 0 }, 1); d += car.vx * P().DT; }
    return d;
  }
  function analyze(car, build) {
    build = Object.assign(defaultBuild(), build || {});
    const key = car.id + JSON.stringify([build.engine, build.susp, build.tires, build.diffKit, build.diffLock, build.weight]);
    if (cache[key]) return cache[key];
    const p = toPhysics(car, build);
    const t100 = measureAccel(p), stop = measureBrake(p);
    const muAvg = (p.muF * (1 - p.wf) + p.muR * p.wf);
    const skidV = Math.sqrt(muAvg * P().G * 30);                                  // speed round a 30 m radius
    const driftStab = Math.round(100 * P().clamp(0.45 * ((p.slideR - 0.66) / 0.3) + 0.3 * (1 - Math.abs(p.wf - 0.53) * 5) + 0.25 * P().clamp(1.25 - (p.power / p.mass) / 420, 0, 1), 0, 1));
    const out = {
      hp: Math.round(p.power / (HP * 0.82)), kg: Math.round(p.mass), topKmh: Math.round(p.topSpeed * 3.6), t100: +t100.toFixed(1), stop: Math.round(stop),
      grip: muAvg, skidKmh: Math.round(skidV * 3.6),
      // 0-100 ratings (derived from the measured/physical values above; for comparing cars and upgrades)
      rAccel: rate(t100, 8.5, 3.2), rTop: rate(p.topSpeed * 3.6, 190, 300, true), rGrip: rate(muAvg, 0.95, 1.3, true), rHandling: rate(skidV * 3.6, 62, 84, true),
      rDrift: driftStab, rPower: rate(p.power / HP / 0.82, 140, 500, true), rWeight: rate(p.mass, 1550, 820),
    };
    return (cache[key] = out);
  }
  function rate(v, lo, hi, rising) { const t = (v - lo) / (hi - lo); return Math.round(100 * Math.max(0.04, Math.min(1, t))); }

  function paintOf(build) { return PAINTS[(build && build.paint) || 0] || PAINTS[0]; }

  TD.Vehicles = { CARS, carById, COMPOUNDS, PAINTS, WHEELS, WHEEL_COLORS, STAGE_NAMES, defaultBuild, toPhysics, upgradeCost, analyze, paintOf, carFactor, ENGINE, WEIGHT };
})();
