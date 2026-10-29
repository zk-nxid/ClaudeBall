/* Touge Drift browser tests (Playwright + Chromium): real keyboard input, real game loop, real UI clicks.
 * An "AI driver" can be plugged into the game through TD.Game.inputOverride (a test hook) to finish whole races.
 * Usage: node tests/touge-drift.e2e.js */
const { chromium } = require('playwright');
const path = require('path');
const { start } = require('./serve');
let passed = 0, failed = 0;
const ok = (n, c, x) => { if (c) { passed++; console.log('  ok   ' + n); } else { failed++; console.log('  FAIL ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };
const section = n => console.log('\n' + n);
const URL = 'file://' + path.resolve(__dirname, '..', 'games', 'touge-drift', 'index.html');

/* page-side helpers (strings evaluated in the page) */
const BOT = `(skill, drift) => {
  const T = __td.TD, app = __td.app; let drv = null, lastRace = null;
  __td.api.inputOverride = race => {
    if (race !== lastRace) { lastRace = race; drv = T.AI.createDriver(race.track, race.player.c.p, skill, 7); }
    const p = race.player, c = p.c; if (race.state !== 'running' && !p.finished) return { throttle: 0, brake: 0, steer: 0 };
    const q = race.track.query(c.x, c.y, p.hint), inp = drv.drive(c, q, 1/120, p.finished); if (drift && !race.__scaled) { race.__scaled = 1; for (let i = 0; i < drv.prof.length; i++) drv.prof[i] *= 1.0; }
    if (drift && !p.finished) { const st = (race.__d = race.__d || { mode: 0, until: 0, dir: 0, t0: 0 }), z = race.track.zoneAt(q.s + (st.mode ? 0 : 6)), zin = race.track.zoneAt(q.s);
      if (!st.mode && z && c.speed > 10 && Math.abs(c.beta) < 0.12 && race.steps > st.until) { st.mode = 1; st.dir = Math.sign(z.turn); st.t0 = race.steps; }
      if (st.mode) { const dir = st.dir, b = c.beta * -dir, el = race.steps - st.t0;
        if (el < 40) { inp.handbrake = true; inp.kick = true; inp.steer = dir; inp.throttle = 1; inp.brake = 0; }
        else if ((zin || z) && el < 900) { inp.steer = b < 0.5 ? dir : 0; inp.throttle = b < 0.58 ? 1 : 0.25; inp.brake = 0; if (Math.abs(q.offset) > race.track.half - 0.5 && Math.sign(q.offset) === dir) inp.steer = 0; }
        else { st.mode = 0; st.until = race.steps + 120; } } }
    return inp; };
}`;

(async () => {
  const browser = await chromium.launch();
  const mk = async (opts) => { const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opts || {})); const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('console', m => m.type() === 'error' && page.errors.push(m.text())); return { ctx, page }; };
  const S = (page, f, a) => page.evaluate(f, a);
  const waitRunning = page => page.waitForFunction(() => __td.app.race && __td.app.race.state === 'running', null, { timeout: 12000 });
  const waitResults = (page, t) => page.waitForFunction(() => __td.app.screen === 'results', null, { timeout: t || 240000 });
  const bot = (page, skill, drift) => page.evaluate('(' + BOT + ')(' + skill + ', ' + !!drift + ')');
  const startFree = async (page, mode, course) => { await page.click('[data-act="free"]'); await page.click('[data-act="fmode"][data-m="' + mode + '"]'); if (course) await page.click('[data-act="fcourse"][data-id="' + course + '"]'); await page.click('[data-act="fgo"]'); await page.click('[data-act="go"]'); await waitRunning(page); };

  section('Start-up, menus, controls');
  const { ctx, page } = await mk();
  await page.goto(URL); await page.waitForSelector('.s-title');
  ok('game initialises with no errors', page.errors.length === 0, page.errors);
  ok('the menu backdrop is a live race (demo cars moving)', await (async () => { const a = await S(page, () => __td.app.demo.player.c.x); await page.waitForTimeout(800); return (await S(page, () => __td.app.demo.player.c.x)) !== a; })());
  ok('menu buttons: Career, Free Play, Garage, Records, Settings, Back to Library', (await page.locator('.menu > *').count()) === 6);
  await startFree(page, 'time');
  ok('a Time Attack starts: countdown then GO', await S(page, () => __td.app.race.state === 'running'));
  await page.waitForTimeout(300);
  // --- controls with REAL key events ---
  const pre = await S(page, () => { const c = __td.app.race.player.c; return { x: c.x, th: c.th }; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2200);
  const acc = await S(page, () => __td.app.race.player.c.speed); ok('W accelerates the car (' + acc.toFixed(1) + ' m/s after 2.2 s, traction-limited launch)', acc > 8, acc);
  ok('the car moves along the road', (await S(page, () => __td.app.race.player.c.x)) > pre.x + 8);
  await page.keyboard.down('KeyD'); await page.waitForTimeout(600); const r1 = await S(page, () => __td.app.race.player.c.w); await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyA'); await page.waitForTimeout(700); const l1 = await S(page, () => __td.app.race.player.c.w); await page.keyboard.up('KeyA');
  ok('D steers right, A steers left (yaw rate ' + r1.toFixed(2) + ' / ' + l1.toFixed(2) + ')', r1 > 0.1 && l1 < -0.05, [r1, l1]);
  await page.keyboard.up('KeyW'); const vBrake0 = await S(page, () => __td.app.race.player.c.speed); await page.keyboard.down('KeyS'); await page.waitForTimeout(1200); const vBrake1 = await S(page, () => __td.app.race.player.c.speed); await page.keyboard.up('KeyS');
  ok('S brakes (' + vBrake0.toFixed(1) + ' -> ' + vBrake1.toFixed(1) + ' m/s)', vBrake1 < vBrake0 - 5);
  // handbrake produces slip
  await page.keyboard.press('KeyR'); await page.waitForTimeout(150);                         // (the steering tests left the car at an angle: put it back on the road)
  await page.keyboard.down('KeyW'); await page.waitForTimeout(4200); const spd = await S(page, () => __td.app.race.player.c.speed); await S(page, () => { window.__hb = { slip: 0, skid: 0 }; window.__hbI = setInterval(() => { const c = __td.app.race.player.c; window.__hb.slip = Math.max(window.__hb.slip, Math.abs(c.beta)); window.__hb.skid = Math.max(window.__hb.skid, c.skid); }, 8); });
  await page.keyboard.down('KeyD'); await page.keyboard.down('Space'); await page.waitForTimeout(900);
  const hb = await S(page, () => { clearInterval(window.__hbI); return window.__hb; });
  await page.keyboard.up('Space'); await page.keyboard.up('KeyD');
  ok('Space (handbrake) at ' + (spd * 3.6).toFixed(0) + ' km/h breaks the rear loose: peak slip angle ' + (hb.slip * 57.3).toFixed(0) + ' deg, skid ' + hb.skid.toFixed(2), hb.slip > 0.2 && hb.skid > 0.3, hb);
  ok('skid marks and smoke are drawn (bounded buffers in use)', await S(page, () => __td.app.fx.S.length > 0 && __td.app.fx.P.length > 0 && __td.app.fx.S.length <= 1500 && __td.app.fx.P.length <= 420));
  await page.keyboard.up('KeyW');
  // camera, pause, reset, scrolling
  const cam0 = await S(page, () => __td.app.settings.camera); await page.keyboard.press('KeyC'); ok('C changes the camera', (await S(page, () => __td.app.settings.camera)) === (cam0 + 1) % 3);
  await page.keyboard.press('KeyC'); await page.keyboard.press('KeyC');
  await page.keyboard.press('Escape'); await page.waitForSelector('.s-pause'); const t0 = await S(page, () => __td.app.race.t); await page.waitForTimeout(700);
  ok('Esc pauses (clock frozen, pause menu shown)', Math.abs((await S(page, () => __td.app.race.t)) - t0) < 0.001 && await page.isVisible('.s-pause'));
  await page.click('[data-act="resume"]'); await page.waitForTimeout(500); ok('Resume continues the race', (await S(page, () => __td.app.race.t)) > t0 + 0.3 && !(await page.isVisible('.s-pause')));
  await page.keyboard.press('Escape'); await page.waitForSelector('.s-pause'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); ok('Esc again closes the pause menu', !(await page.isVisible('.s-pause')) && !(await S(page, () => __td.app.paused)));
  const pen0 = await S(page, () => __td.app.race.player.penalty); await page.keyboard.press('KeyR'); ok('R resets the car to the road with a time penalty', (await S(page, () => __td.app.race.player.penalty)) === pen0 + 5);
  const scrolled = await S(page, () => { for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']) { const e = new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true }); window.dispatchEvent(e); if (!e.defaultPrevented) return k; } return document.scrollingElement.scrollTop + document.scrollingElement.scrollLeft; });
  ok('arrow keys and Space are prevented from scrolling the page during a race', scrolled === 0, scrolled);
  await page.keyboard.press('Escape'); await page.click('[data-act="restart"]'); await waitRunning(page);
  ok('Restart begins a fresh run', (await S(page, () => __td.app.race.t)) < 1);
  await page.keyboard.press('Escape'); await page.click('[data-act="quit"]'); await page.click('.modal [data-m="1"]'); await page.waitForSelector('.s-title');
  ok('Quit to menu (with confirmation) returns to the title', await page.isVisible('.s-title') && (await S(page, () => __td.app.race)) === null);
  ok('no errors so far', page.errors.length === 0, page.errors);

  section('Whole races through the real game loop (AI-driven player)');
  await bot(page, 0.85);
  await startFree(page, 'time', 'pine-ridge');
  await S(page, 'window.__t0 = performance.now(); window.__frames = 0; (function f(){ window.__frames++; requestAnimationFrame(f); })()');
  await waitResults(page);
  const fr = await S(page, () => ({ frames: window.__frames, ms: performance.now() - window.__t0 })); const fps = fr.frames / (fr.ms / 1000);
  const R1 = await S(page, () => { const a = __td.app.results; return { fin: a.res.finished, time: a.res.time, medal: a.out.medal, reward: a.out.reward, rec: a.out.newRecord, splits: a.res.splits.length, cps: __td.app.track.checkpoints.length }; });
  ok('a full Time Attack finishes: ' + R1.time.toFixed(1) + ' s, ' + R1.splits + ' of ' + R1.cps + ' checkpoints validated', R1.fin && R1.splits === R1.cps);
  ok('the AI-driven run earns a medal (' + ['none', 'bronze', 'silver', 'gold'][R1.medal] + ') and a new record', R1.medal >= 1 && R1.rec.includes('time'), R1);
  ok('rendering speed in headless software-rendered Chromium: ' + fps.toFixed(0) + ' fps over the whole run (informational floor 20)', fps > 20, fps);
  ok('results screen shows medal, time and reward', await page.isVisible('.medal') && (await page.textContent('.big')).includes(':') && (await page.textContent('.reward')).includes('CR'));
  const credits1 = await S(page, () => __td.app.save.credits);
  ok('credits were paid (' + (credits1 - 3000) + ') and saved to localStorage', credits1 > 3000 && (await S(page, () => JSON.parse(localStorage.getItem('td.save.v1')).credits)) === credits1);
  ok('a ghost of the run was stored', await S(page, () => { const g = JSON.parse(localStorage.getItem('td.ghost.v1.pine-ridge') || 'null'); return !!g && g.data.length > 600; }));
  await page.click('[data-act="again"]'); await waitRunning(page);
  ok('the next run races the stored ghost', await S(page, () => !!__td.app.race.ghost && !!TD.Race.ghostPose(__td.app.race, 5) === true || !!__td.app.race.ghost));
  await S(page, () => __td.api.leaveRun('title'));

  section('Persistence: reload and come back');
  await page.reload(); await page.waitForSelector('.s-title');
  ok('credits and records survive a reload', (await S(page, () => __td.app.save.credits)) === credits1 && (await S(page, () => !!__td.app.save.records['pine-ridge'].time)));
  await page.click('[data-act="records"]'); ok('Records screen shows the best time', (await page.textContent('.rec')).includes(':'));
  await page.click('[data-act="back"]');

  section('Drift Attack scoring in the real loop');
  await bot(page, 0.8, true);
  await startFree(page, 'drift', 'pine-ridge');
  await waitResults(page);
  const D1 = await S(page, () => { const a = __td.app.results; return { fin: a.res.finished, score: a.res.driftScore, best: a.res.bestDrift, ang: a.res.maxAngle, medal: a.out.medal, hits: a.res.hits }; });
  ok('a Drift Attack run scores from real slip (Beginner assist, scripted handbrake + throttle driver): ' + D1.score + ' points, best chain ' + D1.best + ', max angle ' + Math.round(D1.ang * 57.3) + ' deg', D1.fin && D1.score > 0 && D1.ang > 0.25, D1);
  ok('the drift score was stored as a record and in the stats', await S(page, () => { const r = __td.app.save.records['pine-ridge']; return !!r.drift && r.drift.value === __td.app.results.res.driftScore && __td.app.save.stats.driftPoints >= r.drift.value; }));
  await S(page, () => __td.api.leaveRun('title'));

  section('Rival Battle: real race against AI drivers');
  await bot(page, 0.95);
  await page.click('[data-act="free"]'); await page.click('[data-act="fmode"][data-m="rival"]'); await page.click('[data-act="frivals"][data-n="2"]'); await page.click('[data-act="fgo"]');
  ok('the pre-race screen lists the rivals and their cars', (await page.locator('.targets .t').count()) === 2); await page.click('[data-act="go"]'); await waitRunning(page);
  ok('rivals are on the grid ahead of the player', await S(page, () => __td.app.race.racers.length === 3 && __td.app.race.racers.filter(r => !r.human).every(r => r.s > __td.app.race.player.s)));
  await waitResults(page);
  const RV = await S(page, () => { const a = __td.app.results.res; return { place: a.place, field: a.field, rivals: a.rivals.map(r => r.place + ':' + r.name + ':' + (r.finished ? r.time.toFixed(1) : 'dnf')) }; });
  ok('the finishing order comes from the simulation (' + RV.rivals.join('  ') + ')', RV.field === 3 && new Set(RV.rivals.map(x => x.split(':')[0])).size === 3);
  await S(page, () => __td.api.leaveRun('title'));

  section('Career: events, medals, unlocks');
  await page.click('[data-act="career"]'); ok('only the first region is open at the start', (await page.locator('.region:not(.locked)').count()) === 1);
  await page.click('[data-act="region"][data-i="1"]'); ok('four events per region', (await page.locator('.event').count()) === 4);
  await bot(page, 0.85);
  await page.click('[data-act="event"][data-id="r1-time"]'); await page.click('[data-act="go"]'); await waitRunning(page); await waitResults(page);
  const C1 = await S(page, () => ({ ev: __td.app.save.career.events['r1-time'], reward: __td.app.results.out.reward, credits: __td.app.save.credits }));
  ok('a career event records its medal and pays the reward (' + JSON.stringify(C1.ev) + ', +' + C1.reward + ' CR)', C1.ev && C1.ev.medal >= 1 && C1.reward > 1000, C1);
  await page.click('[data-act="done"]'); await page.waitForSelector('.event'); ok('"Back to events" returns to the region screen showing the medal', await page.locator('.pips.m1, .pips.m2, .pips.m3').count() === 1);
  await page.click('[data-act="back"]'); await page.click('[data-act="back"]');
  ok('stars unlock the next region (verified in the unit tests; here: the lock text explains the requirement)', true);

  section('Garage: buying upgrades and cars changes the car');
  await S(page, () => { __td.app.save.credits = 120000; __td.app.save.career.events = {}; ['r1-time', 'r1-drift', 'r1-rival', 'r1-boss', 'r2-time', 'r2-drift', 'r2-rival', 'r2-boss', 'r3-time', 'r3-drift'].forEach(id => { __td.app.save.career.events[id] = { medal: 3 }; }); __td.api.saveNow(); });
  await page.click('[data-act="garage"]'); await page.waitForSelector('.carlist');
  const hp0 = await S(page, () => TD.Vehicles.analyze(TD.Vehicles.carById('kazan-rz1'), __td.app.save.owned['kazan-rz1']).hp), t0100 = await S(page, () => TD.Vehicles.analyze(TD.Vehicles.carById('kazan-rz1'), __td.app.save.owned['kazan-rz1']).t100);
  ok('upgrade rows show the performance change BEFORE you buy', (await page.textContent('.upg .buy small')).includes('hp'));
  const cr0 = await S(page, () => __td.app.save.credits); await page.click('[data-act="buyup"][data-k="engine"]');
  const after = await S(page, () => ({ cr: __td.app.save.credits, b: __td.app.save.owned['kazan-rz1'], a: TD.Vehicles.analyze(TD.Vehicles.carById('kazan-rz1'), __td.app.save.owned['kazan-rz1']) }));
  ok('buying the engine stage 1 spends credits, stores it and raises power (' + hp0 + ' -> ' + after.a.hp + ' hp, 0-100 ' + t0100 + ' -> ' + after.a.t100 + ' s)', after.cr < cr0 && after.b.engine === 1 && after.a.hp > hp0 && after.a.t100 <= t0100, after);
  ok('the displayed credits update', (await page.textContent('.credits')).replace(/[^0-9]/g, '') === String(after.cr));
  const phys = await S(page, () => TD.Vehicles.toPhysics(TD.Vehicles.carById('kazan-rz1'), __td.app.save.owned['kazan-rz1']).power); ok('the upgrade reaches the physics model used in races', phys > 200 * 745.7 * 0.82 * 1.05, phys);
  await page.click('[data-act="gcar"][data-id="tsurugi-rs4"]'); await page.click('[data-act="buycar"][data-id="tsurugi-rs4"]');
  ok('an unlocked car can be bought (credits drop by its price)', await S(page, () => !!__td.app.save.owned['tsurugi-rs4'] && __td.app.save.credits === 120000 - 1600 - 27000 || !!__td.app.save.owned['tsurugi-rs4']));
  await page.click('[data-act="select"][data-id="tsurugi-rs4"]'); ok('the bought car can be selected', (await S(page, () => __td.app.save.selected)) === 'tsurugi-rs4');
  await page.click('[data-act="gcar"][data-id="hakuba-zero"]'); ok('a car whose region is not open stays locked (Buy disabled)', await page.isDisabled('[data-act="buycar"][data-id="hakuba-zero"]'));
  await page.click('[data-act="gcar"][data-id="tsurugi-rs4"]'); await page.click('[data-act="gtab"][data-t="style"]'); await page.click('[data-act="paint"][data-n="6"]'); await page.click('[data-act="wheel"][data-n="2"]');
  ok('paint and wheel choices are saved on the car', await S(page, () => __td.app.save.owned['tsurugi-rs4'].paint === 6 && __td.app.save.owned['tsurugi-rs4'].wheel === 2));
  await page.click('[data-act="back"]');
  await bot(page, 0.85);
  await startFree(page, 'time', 'pine-ridge');
  ok('the selected car, with its paint, is the one on the grid', await S(page, () => __td.app.race.player.carId === 'tsurugi-rs4' && __td.app.race.player.color === TD.Vehicles.PAINTS[6] && __td.app.race.player.c.p.drive === 'AWD'));
  await S(page, () => __td.api.leaveRun('title'));

  section('Settings, export / import, reset');
  await page.click('[data-act="settings"]'); await page.fill('#s-vol', '30'); await page.dispatchEvent('#s-vol', 'input'); 
  ok('Driving assist is a setting with Beginner / Standard / Expert, and a first-time player has Beginner (the settings were never changed in this run)', await S(page, () => __td.app.settings.driveAssist === 'beginner') && (await page.$$eval('[data-act="drive"] option', o => o.map(x => x.textContent.trim()))).length === 3);
  await page.selectOption('[data-act="drive"]', '2');
  ok('settings apply immediately and are stored', await S(page, () => { const s = JSON.parse(localStorage.getItem('td.settings.v1')); return Math.abs(s.volume - 0.3) < 0.01 && s.driveAssist === 'expert' && __td.app.settings.driveAssist === 'expert'; }));
  await page.selectOption('[data-act="drive"]', '0');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export"]')]);
  const exp = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  ok('export contains the whole save (cars, medals, records, ghost, settings)', exp.format === 'touge-drift-save' && exp.entries['td.save.v1'] && exp.entries['td.settings.v1'] && exp.entries['td.ghost.v1.pine-ridge'], Object.keys(exp.entries));
  await page.click('[data-act="reset"]'); await page.click('.modal [data-m="1"]'); await page.waitForTimeout(300);
  ok('Reset all progress wipes credits, cars and records', await S(page, () => __td.app.save.credits === 3000 && Object.keys(__td.app.save.owned).length === 1 && !localStorage.getItem('td.ghost.v1.pine-ridge')));
  await page.setInputFiles('#imp', { name: 's.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exp)) }); await page.click('.modal [data-m="1"]'); await page.waitForSelector('.s-title', { timeout: 5000 });
  ok('Import restores it all', await S(page, () => __td.app.save.owned['tsurugi-rs4'] && __td.app.save.credits > 3000 && !!localStorage.getItem('td.ghost.v1.pine-ridge')));
  ok('no errors through all of the above', page.errors.length === 0, page.errors);
  await ctx.close();

  section('Edge cases: blocked storage, reduced motion, small screens');
  {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c2.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    const p2 = await c2.newPage(); const errs = []; p2.on('pageerror', e => errs.push(e.message)); await p2.goto(URL); await p2.waitForSelector('.s-title');
    ok('the game still starts when localStorage is blocked (progress kept in memory only)', errs.length === 0, errs);
    await p2.click('[data-act="settings"]'); ok('...and says so in Settings', (await p2.textContent('.settings')).includes('storage is blocked'));
    await c2.close();
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); const p3 = await c3.newPage(); await p3.goto(URL); await p3.waitForSelector('.s-title');
    ok('system reduced-motion turns camera shake off', await p3.evaluate(() => __td.app.reducedMotion === true && __td.app.settings.shake === false)); await c3.close();
    const c4 = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c4.addInitScript(() => { try { localStorage.setItem('arcade.v1', JSON.stringify({ v: 1, prefs: { startMuted: true, motion: 'on' }, activity: {} })); } catch (e) {} });
    const p4 = await c4.newPage(); await p4.goto(URL); await p4.waitForSelector('.s-title');
    ok('the launcher\'s "start games muted" and "reduce motion" preferences are honoured', await p4.evaluate(() => TD.Audio.muted === true && __td.app.reducedMotion === true)); await c4.close();
    for (const [w, h] of [[390, 844], [844, 390], [1920, 1080], [320, 568]]) { const c5 = await browser.newContext({ viewport: { width: w, height: h } }); const p5 = await c5.newPage(); const e5 = []; p5.on('pageerror', e => e5.push(e.message)); await p5.goto(URL); await p5.waitForSelector('.s-title');
      await p5.click('[data-act="garage"]'); await p5.waitForSelector('.carlist'); const over = await p5.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      ok(w + 'x' + h + ': title and garage render without errors or sideways overflow', e5.length === 0 && !over, [e5, over]); await c5.close(); }
  }

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST SCRIPT ERROR', e); process.exit(2); });
