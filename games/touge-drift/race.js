/* Touge Drift - one race / run. Pure logic (no DOM, no rendering): used by the game and by the headless tests.
 * Owns the cars on the road, the countdown, checkpoints and finish validation, timing (with reset penalties), drift
 * scoring, AI rivals, the ghost recorder/player and the final results. Advance it with step() at the fixed physics rate. */
(function () {
  'use strict';
  const TD = (globalThis.TD = globalThis.TD || {});
  const P = () => TD.Physics, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const COUNTDOWN = 3.4, RESET_PENALTY = 5, GHOST_DT = 0.05, SETTLE = 2.2;

  /** opts: { track, mode: 'time'|'drift'|'rival', player: { carId, build, name, color }, rivals: [{ carId, build, skill, name, color }],
   *          assist: 0..1, ghost: { data:[x,y,th,...] } | null } */
  function create(opts) {
    const track = opts.track, V = TD.Vehicles;
    const r = { track, mode: opts.mode || 'time', assist: opts.assist == null ? 0.55 : opts.assist, state: 'countdown', clock: -COUNTDOWN, t: 0, racers: [], done: false, doneAt: 0,
                ghost: opts.ghost || null, rec: [], recAcc: 0, events: [], steps: 0 };
    const grid = []; const list = (opts.rivals || []).concat([Object.assign({}, opts.player, { human: true })]);
    list.forEach((def, slot) => {
      const car = V.carById(def.carId), phys = V.toPhysics(car, def.build);
      const pose = track.poseAt(track.startS - 5.5 - (list.length - 1 - slot) * 7.5, (slot % 2 ? 1 : -1) * 1.9);
      const c = P().createCar(phys, pose.x, pose.y, pose.th);
      const q0 = track.query(pose.x, pose.y, -1);
      const rc = { def, name: def.name || (def.human ? 'You' : 'Rival'), human: !!def.human, color: def.color || V.paintOf(def.build), carId: def.carId, car, c, hint: q0.idx, s: q0.s, nextCp: 0, splits: [], finished: false, finishTime: null, penalty: 0, resets: 0, lastCp: -1,
                   input: { throttle: 0, brake: 0, steer: 0, handbrake: false, kick: false }, driver: null, drift: def.human ? TD.Drift.create() : null, place: 0, wrong: false, recoveries: 0, offRoad: 0, hits: 0, topSpeed: 0 };
      if (!rc.human) rc.driver = TD.AI.createDriver(track, phys, def.skill == null ? 0.8 : def.skill, slot + 1);
      r.racers.push(rc);
    });
    r.player = r.racers[r.racers.length - 1];
    return r;
  }

  function resetPlayerTo(r, rc, sv) {
    const track = r.track, pose = track.poseAt(Math.max(track.startS - 5, sv), 0);
    rc.c.x = pose.x; rc.c.y = pose.y; rc.c.th = pose.th; rc.c.vx = rc.c.vy = rc.c.w = rc.c.speed = rc.c.beta = 0; rc.c.steer = 0; rc.c.thr = 0; rc.c.brk = 0; rc.c.aF = rc.c.aR = 0; rc.c.axs = 0;
    rc.hint = -1; const q = track.query(pose.x, pose.y, -1); rc.hint = q.idx; rc.s = q.s;
  }

  /** Player asks to be put back on the road at the last checkpoint (5 s penalty, drift chain lost). */
  function reset(r) {
    const p = r.player; if (r.state !== 'running' || p.finished) return false;
    const cp = p.lastCp >= 0 ? r.track.checkpoints[p.lastCp].s : r.track.startS;
    resetPlayerTo(r, p, cp - 3); p.resets++; p.penalty += RESET_PENALTY;
    if (p.drift) { p.drift.chain = 0; p.drift.combo = 1; p.drift.active = false; p.drift.t = 0; p.drift.gap = 0; }
    r.events.push({ type: 'reset' });
    return true;
  }

  /** Advance one fixed physics step. humanInput: { throttle, brake, steer (-1..1), handbrake, kick } (raw, digital or analog). */
  function step(r, humanInput) {
    const dt = P().DT, track = r.track; r.steps++; r.events.length = 0;
    r.clock += dt;
    if (r.state === 'countdown') {
      const was = Math.ceil(-r.clock + dt);
      if (r.clock >= 0) { r.state = 'running'; r.t = 0; r.events.push({ type: 'go' }); }
      else if (Math.ceil(-r.clock) !== was) r.events.push({ type: 'count', n: Math.ceil(-r.clock) });
      return;
    }
    r.t += dt;
    for (const rc of r.racers) {
      const c = rc.c;
      // 1. input
      let inp;
      const q0 = track.query(c.x, c.y, rc.hint); rc.hint = q0.idx;
      if (rc.finished) { inp = rc.driver ? rc.driver.drive(c, q0, dt, true) : (rc.coast = rc.coast || TD.AI.createDriver(track, c.p, 0.7, 99)).drive(c, q0, dt, true); }
      else if (rc.human) inp = humanInput || rc.input; else inp = rc.driver.drive(c, q0, dt, false);
      if (inp.recover) { const s0 = q0.s; resetPlayerTo(r, rc, s0 + 2); rc.recoveries++; rc.driver.stuck = 0; continue; }
      const assist = rc.human && !rc.finished ? r.assist : 0;
      P().driverSteer(c, inp.steer || 0, rc.human ? assist : 0, dt);
      P().driverPedals(c, inp.throttle || 0, inp.brake || 0, dt, rc.human ? assist : 0);
      // 2. physics
      P().step(c, { throttle: c.thr, brake: c.brk, steer: c.steer, handbrake: !!inp.handbrake, kick: !!inp.kick }, q0.surf);
      const impact = P().collideTrack(c, track, rc.hint);
      if (impact > 2.5) { rc.hits++; r.events.push({ type: 'hit', who: rc, impact }); }
      // 3. progress / checkpoints / finish
      const q = track.query(c.x, c.y, rc.hint); rc.hint = q.idx; rc.s = q.s;
      const onRoad = q.onRoad; rc.offRoad = onRoad ? 0 : rc.offRoad + dt;
      rc.wrong = Math.cos(q.hd - c.th) < -0.25 && c.speed > 3;
      rc.topSpeed = Math.max(rc.topSpeed, c.speed);
      if (rc.human && rc.drift && !rc.finished) {
        const z = track.zoneAt(q.s);
        TD.Drift.update(rc.drift, c, onRoad, !!z, impact, dt);
        for (const e of rc.drift.events) r.events.push(Object.assign({ who: rc }, e));
      }
      if (!rc.finished) {
        while (rc.nextCp < track.checkpoints.length && rc.s >= track.checkpoints[rc.nextCp].s) {
          const cp = track.checkpoints[rc.nextCp], tAt = r.t - Math.max(0, rc.s - cp.s) / Math.max(c.speed, 1);
          rc.splits.push(tAt + rc.penalty); rc.lastCp = rc.nextCp;
          if (cp.finish) { rc.finished = true; rc.finishTime = tAt + rc.penalty; if (rc.human) { r.events.push({ type: 'finish', who: rc }); if (rc.drift) TD.Drift.finish(rc.drift); } else r.events.push({ type: 'rivalFinish', who: rc }); }
          else if (rc.human) r.events.push({ type: 'checkpoint', index: rc.nextCp, total: track.checkpoints.length - 1, time: tAt + rc.penalty });
          rc.nextCp++;
        }
      }
    }
    // car-to-car contact
    for (let i = 0; i < r.racers.length; i++) for (let j = i + 1; j < r.racers.length; j++) {
      const imp = P().collideCars(r.racers[i].c, r.racers[j].c);
      if (imp > 2) r.events.push({ type: 'bump', impact: imp, who: r.racers[i].human ? r.racers[i] : r.racers[j] });
    }
    // ghost recording (player) at 20 Hz
    if (!r.player.finished) { r.recAcc += dt; if (r.recAcc >= GHOST_DT) { r.recAcc -= GHOST_DT; r.rec.push(Math.round(r.player.c.x * 20) / 20, Math.round(r.player.c.y * 20) / 20, Math.round(r.player.c.th * 500) / 500); } }
    // ranking
    const order = r.racers.slice().sort((a, b) => (a.finished && b.finished) ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.s - a.s);
    order.forEach((rc, k) => { rc.place = k + 1; });
    // end of the run: a moment after the player crosses the line
    if (r.player.finished && !r.done) { r.doneAt = r.doneAt || r.t; if (r.t - r.doneAt >= SETTLE) { r.done = true; r.state = 'finished'; } }
  }

  /** Ghost pose at race time t (seconds since GO), or null. */
  function ghostPose(r, t) {
    const g = r.ghost && r.ghost.data; if (!g || g.length < 6 || t < 0) return null;
    const f = t / GHOST_DT, i = Math.floor(f), n = g.length / 3; if (i >= n - 1) return null;
    const u = f - i, a = i * 3, b = a + 3; let dh = g[b + 2] - g[a + 2]; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
    return { x: g[a] + (g[b] - g[a]) * u, y: g[a + 1] + (g[b + 1] - g[a + 1]) * u, th: g[a + 2] + dh * u };
  }

  function results(r) {
    const p = r.player, order = r.racers.slice().sort((a, b) => a.place - b.place);
    return { mode: r.mode, finished: p.finished, time: p.finishTime, penalty: p.penalty, resets: p.resets, place: p.place, field: r.racers.length,
             rivals: order.map(o => ({ name: o.name, place: o.place, time: o.finishTime, finished: o.finished, human: o.human, s: o.s })),
             driftScore: p.drift ? Math.round(p.drift.score) : 0, bestDrift: p.drift ? p.drift.best : 0, maxAngle: p.drift ? p.drift.maxAngle : 0, hits: p.hits,
             splits: p.splits.slice(), topSpeed: p.topSpeed, ghost: p.finished ? { carId: p.carId, dt: GHOST_DT, data: r.rec.slice() } : null };
  }

  TD.Race = { create, step, reset, results, ghostPose, COUNTDOWN, RESET_PENALTY };
})();
