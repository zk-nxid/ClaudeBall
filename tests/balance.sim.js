/* Career balance simulation (headless): an AI "player" of a chosen skill plays the career in order with the real physics,
 * rival AI and progression rules, spending credits the way a sensible player would. Shows whether progression is
 * reachable through normal play: medals, unlocks, credits, cars. It cannot stand in for a human, and the AI does not drift,
 * so Drift Attack events are skipped (scored as 0): a player who can drift only has it easier.
 * Usage: node tests/balance.sim.js [skill 0.5-1] [attempts per event] */
const path = require('path');
const dir = path.resolve(__dirname, '..', 'games', 'touge-drift');
for (const f of ['physics', 'vehicles', 'tracks', 'drift', 'ai', 'race', 'progression']) require(path.join(dir, f + '.js'));
const { Vehicles: V, Progress, Race, AI, Save } = TD;
const skill = +(process.argv[2] || 0.7), attempts = +(process.argv[3] || 2), quiet = process.argv.includes('--quiet');
const s = Save.defaultSave();
function play(ev, carId) {
  const track = Progress.track(ev.course), rivals = ev.mode === 'rival' ? Progress.rivalsFor(ev) : [];
  const r = Race.create({ track, mode: ev.mode === 'rival' ? 'rival' : 'time', player: { carId, build: s.owned[carId], name: 'You' }, rivals, assist: 0 });
  const pl = r.player; pl.human = false; pl.driver = AI.createDriver(track, pl.c.p, skill, 11); let n = 0;
  while (!r.done && r.t < 500 && n++ < 120 * 520) Race.step(r, null);
  return Race.results(r);
}
function bestCar() { return Object.keys(s.owned).sort((a, b) => V.analyze(V.carById(b), s.owned[b]).t100 * 0 + (V.analyze(V.carById(a), s.owned[a]).skidKmh + V.analyze(V.carById(a), s.owned[a]).topKmh / 4) - (V.analyze(V.carById(b), s.owned[b]).skidKmh + V.analyze(V.carById(b), s.owned[b]).topKmh / 4))[Object.keys(s.owned).length - 1]; }
function spend() {   // buy the cheapest sensible upgrade for the best car, then a car when affordable and unlocked
  let bought = true;
  while (bought) { bought = false; const id = bestCar(), car = V.carById(id), b = s.owned[id];
    const opts = [['tires', 2], ['engine', b.engine + 1], ['susp', b.susp + 1], ['weight', b.weight + 1], ['tires', 3]].filter(o => o[0] === 'tires' ? b.tires < o[1] : o[1] <= 3).map(o => ({ k: o[0], n: o[1], c: o[0] === 'tires' ? V.upgradeCost(car, 'tires', o[1]) : V.upgradeCost(car, o[0], o[1]) })).sort((x, y) => x.c - y.c);
    // prefer a better car when one is affordable and unlocked
    const nextCar = V.CARS.filter(c => !s.owned[c.id] && Progress.carUnlocked(s, c) && c.price <= s.credits).sort((a, b) => b.price - a.price)[0];
    if (nextCar && nextCar.price > (opts[0] ? opts[0].c * 2 : 0)) { Progress.buyCar(s, nextCar.id); s.selected = nextCar.id; bought = true; continue; }
    for (const o of opts) if (o.c <= s.credits) { const r = Progress.buyUpgrade(s, id, o.k, o.n); if (r.ok) { bought = true; break; } } }
}
const log = [];
for (let region = 1; region <= 6; region++) {
  if (!Progress.regionUnlocked(s, region)) { log.push('region ' + region + ' LOCKED (stars in previous: ' + Progress.stars(s, region - 1) + ')'); break; }
  for (const ev of Progress.EVENTS().filter(e => e.region === region)) {
    if (ev.mode === 'drift') continue;
    let best = null;
    for (let a = 0; a < attempts; a++) { spend(); const carId = bestCar(); const res = play(ev, carId); const out = Progress.applyResult(s, { mode: ev.mode, courseId: ev.course, eventId: ev.id, carId }, res); if (!best || out.medal > best.medal) best = { medal: out.medal, place: res.place, time: res.time, car: carId }; }
    log.push('r' + region + ' ' + ev.id.padEnd(8) + ' medal ' + Progress.MEDAL_NAMES[best.medal].padEnd(7) + (ev.mode === 'rival' ? ' place ' + best.place + '/' + (ev.rivals + 1) : ' time ' + (best.time && best.time.toFixed(1))) + '  car ' + best.car + '  credits ' + s.credits);
  }
}
if (!quiet) console.log(log.join('\n'));
const regions = Progress.regionsUnlocked(s), cars = Object.keys(s.owned).length, stars = Progress.EVENTS().reduce((n, e) => n + ((s.career.events[e.id] || {}).medal || 0), 0);
console.log('skill ' + skill + ': regions unlocked ' + regions + '/6, cars owned ' + cars + '/8, stars ' + stars + ', credits ' + s.credits + ', earned ' + s.stats.creditsEarned);
if (require.main === module && process.argv.includes('--assert')) { const ok = regions === 6; console.log(ok ? 'ok: all six regions reachable by this player' : 'FAIL: progression stalls at region ' + regions); process.exit(ok ? 0 : 1); }
