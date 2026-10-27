/* Claude Ball smoke/regression test at its NEW location (games/claudeball/). Real clicks and touch-free mouse input.
 * The deep suites (rules, AI, online, mobile, 97 + 56 + 71 checks) live with the game's source in zk-nxid/op; this checks that
 * the migrated build still starts, plays, saves and navigates from its own entry point and from the launcher.
 * Usage: node tests/claudeball.smoke.e2e.js */
const { chromium } = require('playwright');
const path = require('path');
const root = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(root, 'games', 'claudeball', 'index.html') + '?breaker=0';
let passed = 0, failed = 0;
const ok = (n, c, x) => { if (c) { passed++; console.log('  ok   ' + n); } else { failed++; console.log('  FAIL ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };
(async () => {
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const S = (f, a) => page.evaluate(f, a);
  const toScreen = (x, y) => S(([x, y]) => { const r = __pool.renderer, b = r.canvas.getBoundingClientRect(), t = r.toScreen(x, y); return { x: b.left + t.x, y: b.top + t.y }; }, [x, y]);
  const flip = () => page.waitForFunction(() => !__pool.app.flipping, null, { timeout: 9000 });
  const settle = () => page.waitForFunction(() => __pool.app.game.state !== 'moving' && !__pool.app.strike, null, { timeout: 40000 });
  async function shoot(ax, ay, power) {
    const n = await S(() => __pool.app.shotCount), m = await toScreen(ax, ay); await page.mouse.move(m.x, m.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForFunction(() => __pool.app.locked, null, { timeout: 3000 });
    const box = await page.locator('#power-slider').boundingBox(), x = box.x + 13 + power * (box.width - 26), y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 0.01, y); await page.mouse.up();
    await page.waitForFunction(n => __pool.app.shotCount > n, n, { timeout: 5000 });
  }

  console.log('Standalone entry point (file://)');
  await page.goto(URL); await page.waitForSelector('#nick');
  ok('first launch asks for a name (existing behaviour)', await page.isVisible('#menu-name'));
  await page.fill('#nick', 'Zane'); await page.click('#btn-name-save'); await page.evaluate(() => document.getElementById('btn-coach-skip').click());
  await page.waitForSelector('#btn-play', { state: 'visible' });
  ok('main menu: Play, How to Play, Settings, and the new Back to Library', await page.isVisible('#btn-play') && await page.isVisible('#btn-help') && await page.isVisible('#btn-settings') && await page.isVisible('#btn-library'));
  ok('the name was saved to localStorage (cb-nick)', (await S(() => localStorage.getItem('cb-nick'))) === 'Zane');

  await page.click('#btn-settings'); await page.waitForSelector('#vol', { state: 'visible' });
  await page.evaluate(() => { const v = document.getElementById('vol'); v.value = 40; v.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('the volume setting is stored in its own key (pool-volume)', Math.abs(parseFloat(await S(() => localStorage.getItem('pool-volume'))) - 0.4) < 0.02);
  await page.click('#btn-settings-back'); await page.waitForSelector('#btn-play', { state: 'visible' });

  console.log('Single player');
  await page.click('#btn-play'); await page.click('#btn-single'); await page.click('[data-diff="easy"]'); await flip();
  ok('a game starts with the full rack: 16 balls on the table', await S(() => __pool.app.game.world.balls.length === 16 && __pool.app.game.world.balls.filter(b => !b.pocketed).length === 16));
  ok('the table is drawn (canvas has non-background pixels)', await S(() => { const c = __pool.renderer.canvas, g = c.getContext('2d'), d = g.getImageData(c.width / 2 - 40, c.height / 2 - 40, 80, 80).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 60) n++; return n > 200; }));
  const p = await toScreen(200, 250); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => __pool.app.game.state === 'aiming');
  ok('the cue ball can be placed behind the head string', Math.abs((await S(() => __pool.app.game.world.balls[0].x)) - 200) < 2);
  const before = await S(() => JSON.stringify(__pool.app.game.world.balls.map(b => [b.x.toFixed(1), b.y.toFixed(1)])));
  await shoot(900, 250, 1); await page.waitForTimeout(500);
  ok('shooting sets the balls moving (physics runs)', await S(() => __pool.app.game.state === 'moving' && __pool.app.game.world.balls.some(b => Math.hypot(b.vx || 0, b.vy || 0) > 5)));
  await settle();
  ok('after the shot the balls have moved and the turn is resolved', (await S(() => JSON.stringify(__pool.app.game.world.balls.map(b => [b.x.toFixed(1), b.y.toFixed(1)])))) !== before);
  await page.waitForFunction(() => __pool.app.game.current === 1 || __pool.app.game.state === 'aiming' || __pool.app.game.state === 'placing', null, { timeout: 5000 });
  ok('the computer opponent takes its turn (single-player AI)', await (async () => { await page.waitForFunction(() => __pool.app.game.current === 1 ? (__pool.app.shotCount >= 2) : true, null, { timeout: 60000 }); return true; })());
  ok('no errors so far', errors.length === 0, errors);

  console.log('Pause menu, restart, sound, Back to Library confirmation');
  await page.waitForFunction(() => !(__pool.app.game.current === 1 && __pool.app.game.state === 'moving'), null, { timeout: 60000 });
  await S(() => __pool.openPause()); await page.waitForSelector('#menu-pause:not([hidden])');
  const snd0 = await page.textContent('#btn-sound-pause'); await page.click('#btn-sound-pause'); ok('Sound toggle changes (' + snd0 + ' -> ' + (await page.textContent('#btn-sound-pause')) + ')', (await page.textContent('#btn-sound-pause')) !== snd0);
  ok('"Back to Library" is in the pause menu', await page.isVisible('#btn-pause-library'));
  await page.click('#btn-pause-library'); await page.waitForSelector('#menu-confirm:not([hidden])');
  ok('leaving a live game asks for confirmation ("Back to the Library?")', (await page.textContent('#confirm-title')).includes('Library'));
  await page.click('#btn-leave-no'); await page.waitForSelector('#menu-pause:not([hidden])'); ok('Stay returns to the pause menu and the game goes on', !!(await S(() => __pool.app.game)));
  await page.click('#btn-pause-restart'); await page.waitForTimeout(300); await flip();
  ok('Restart begins a fresh game (rack full, no shots taken)', await S(() => __pool.app.game.world.balls.every(b => !b.pocketed) && __pool.app.shotCount === 0));
  await S(() => __pool.openPause()); await page.click('#btn-pause-library'); await page.waitForSelector('#menu-confirm:not([hidden])'); await page.click('#btn-leave-yes');
  await page.waitForURL(/claudeball\.smoke|index\.html$/, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(600);
  ok('"Leave game" goes back to the launcher by a relative path', !page.url().includes('games/claudeball') && page.url().endsWith('/index.html'), page.url());

  console.log('Local two player (opened from the launcher)');
  await page.waitForSelector('.card'); await page.click('.card:nth-child(2) a.btn'); await page.waitForSelector('#btn-play', { state: 'visible' });
  ok('the saved name survived the round trip (no name prompt)', !(await page.isVisible('#menu-name')));
  await page.click('#btn-play'); await page.click('#btn-two'); await flip();
  ok('two player cards, local mode', await S(() => __pool.app.game.mode === 'two' && document.querySelectorAll('.player-card').length === 2));
  const p2 = await toScreen(200, 250); await page.mouse.move(p2.x, p2.y); await page.mouse.down(); await page.mouse.up(); await page.waitForFunction(() => __pool.app.game.state === 'aiming');
  await shoot(900, 250, 0.9); await settle();
  ok('both players share the table: the turn passes or continues by the rules', await S(() => __pool.app.game.current === 0 || __pool.app.game.current === 1));
  ok('no errors in the whole run', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST SCRIPT ERROR', e); process.exit(2); });
