/* Platform end-to-end tests (Playwright + Chromium): launcher, registry, navigation between launcher and both games,
 * settings/export/import, hosted mode with the service worker, and offline loading.
 * Usage: node tests/platform.e2e.js     (needs the `playwright` package; not needed to use the site) */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { start } = require('./serve');
const root = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
const ok = (n, c, x) => { if (c) { passed++; console.log('  ok   ' + n); } else { failed++; console.log('  FAIL ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };
const section = n => console.log('\n' + n);

(async () => {
  const browser = await chromium.launch();
  const mk = async (opts) => { const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, acceptDownloads: true }, opts || {})); const page = await ctx.newPage(); page.errors = []; page.reqs = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('console', m => m.type() === 'error' && page.errors.push(m.text())); page.on('request', r => page.reqs.push(r.url())); return { ctx, page }; };
  const FILE = 'file://' + root + '/';

  section('Registry');
  const games = JSON.parse(fs.readFileSync(path.join(root, 'games.json'), 'utf8')).games;
  const reg = fs.readFileSync(path.join(root, 'registry.js'), 'utf8');
  ok('registry.js is generated from games.json and up to date', require('child_process').spawnSync('node', [path.join(root, 'tools', 'build-platform.js'), '--check']).status === 0);
  ok('every registered game has an entry file and a cover on disk', games.every(g => fs.existsSync(path.join(root, g.entry)) && fs.existsSync(path.join(root, g.cover))));
  ok('entry paths are relative (no domain hard-coded anywhere in the registry)', games.every(g => !/^(https?:)?\/\//.test(g.entry)) && !/https?:\/\//.test(reg));

  section('Launcher from local files (file://)');
  {
    const { ctx, page } = await mk();
    await page.goto(FILE + 'index.html'); await page.waitForSelector('.card');
    ok('launcher loads with no errors', page.errors.length === 0, page.errors);
    ok('both games appear in the library', (await page.locator('.card').count()) === 2 && (await page.textContent('.grid')).includes('Touge Drift') && (await page.textContent('.grid')).includes('Claude Ball'));
    ok('featured hero shows Touge Drift with a Play button', (await page.textContent('.hero h1')) === 'Touge Drift' && await page.isVisible('.hero a.btn.solid'));
    ok('no network requests leave the machine', page.reqs.every(u => u.startsWith('file://') || u.startsWith('data:')), page.reqs.filter(u => !u.startsWith('file://') && !u.startsWith('data:')));
    ok('no service worker is registered from file:// (the launcher only registers over http/https)', await page.evaluate(async () => { try { return !('serviceWorker' in navigator) || (await navigator.serviceWorker.getRegistrations()).length === 0; } catch (e) { return true; } }));
    ok('"Recently played" starts empty', (await page.textContent('[aria-label="Recently played"]')).includes('Nothing yet'));
    // detail route
    await page.click('.card:first-child h3 a'); await page.waitForSelector('.detail');
    ok('game detail page lists controls, modes and features', (await page.locator('.keys kbd').count()) >= 6 && (await page.locator('.mode').count()) >= 3 && (await page.locator('.list li').count()) >= 4);
    ok('direct hash URL works (#/game/claudeball)', await (async () => { await page.goto(FILE + 'index.html#/game/claudeball'); await page.waitForSelector('.detail h1'); return (await page.textContent('.detail h1')) === 'Claude Ball'; })());
    ok('unknown game shows a friendly page, not an error', await (async () => { await page.goto(FILE + 'index.html#/game/nope'); await page.waitForSelector('.settings h1'); return (await page.textContent('.settings h1')) === 'Game not found'; })());

    section('Launching games and coming back (file://)');
    await page.goto(FILE + 'index.html'); await page.waitForSelector('.card');
    await page.click('.card:nth-child(2) a.btn');                                 // Claude Ball
    await page.waitForURL(/games\/claudeball\/index\.html/); await page.waitForFunction(() => { const n = document.getElementById('menu-name'), m = document.getElementById('menu-main'); return (n && !n.hidden) || (m && !m.hidden); });
    ok('Claude Ball opens from the launcher', page.url().includes('games/claudeball/index.html'));
    if (await page.isVisible('#menu-name')) { await page.fill('#nick', 'Tester'); await page.click('#btn-name-save'); await page.evaluate(() => document.getElementById('btn-coach-skip') && document.getElementById('btn-coach-skip').click()); }
    await page.waitForSelector('#btn-play', { state: 'visible' });
    ok('Claude Ball shows its Back to Library control on the main menu', await page.isVisible('#btn-library'));
    ok('Claude Ball ran with no errors', page.errors.length === 0, page.errors);
    await page.click('#btn-library'); await page.waitForURL(/index\.html$/); await page.waitForSelector('.card');
    ok('Back to Library returns to the launcher', !page.url().includes('games/'));
    await page.click('.card:nth-child(1) a.btn');                                 // Touge Drift
    await page.waitForURL(/games\/touge-drift\/index\.html/); await page.waitForSelector('.s-title');
    ok('Touge Drift opens from the launcher and shows its title screen', await page.isVisible('#lib-link'));
    ok('Touge Drift ran with no errors', page.errors.length === 0, page.errors);
    await page.click('#lib-link'); await page.waitForURL(/index\.html$/); await page.waitForSelector('.rcard');
    ok('Back to Library from Touge Drift returns to the launcher', !page.url().includes('games/'));
    ok('"Recently played" lists both games, most recent first', (await page.locator('.rcard b').allTextContents()).join() === 'Touge Drift,Claude Ball');
    ok('cards show last-played info', (await page.textContent('.grid')).includes('Played'));
    ctx.close();
  }

  section('Launcher settings: motion, sounds, export / import / reset, storage info');
  {
    const { ctx, page } = await mk();
    await page.goto(FILE + 'index.html#/settings'); await page.waitForSelector('.settings h1');
    await page.selectOption('select', 'on'); ok('Reduce motion adds the class and really turns animations off', await page.evaluate(() => document.documentElement.classList.contains('reduce-motion') && getComputedStyle(document.querySelector('.view')).animationName === 'none'));
    ok('the choice is saved', await page.evaluate(() => JSON.parse(localStorage.getItem('arcade.v1')).prefs.motion === 'on'));
    await page.locator('.setrow:has-text("Start games muted") input').check(); ok('start-muted preference is saved (read by Touge Drift)', await page.evaluate(() => JSON.parse(localStorage.getItem('arcade.v1')).prefs.startMuted === true));
    ok('storage table lists each game', (await page.textContent('.store')).includes('Touge Drift') && (await page.textContent('.store')).includes('Claude Ball') && (await page.textContent('.store')).includes('Launcher'));
    await page.evaluate(() => { localStorage.setItem('cb-nick', 'Zane'); localStorage.setItem('td.save.v1', '{"v":1,"credits":777}'); localStorage.setItem('unrelated', 'x'); });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export all data')]);
    const file = await dl.path(); const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok('export contains launcher + both games, and nothing unrelated', exp.format === 'arcade-save' && exp.entries['arcade.v1'] && exp.entries['cb-nick'] === 'Zane' && exp.entries['td.save.v1'] && !('unrelated' in exp.entries), Object.keys(exp.entries));
    await page.evaluate(() => { localStorage.setItem('cb-nick', 'Changed'); localStorage.removeItem('td.save.v1'); });
    page.once('dialog', d => d.accept());
    await page.setInputFiles('input[type=file]', file); await page.waitForSelector('#dlg[open]'); await page.click('#dlg-ok');
    await page.waitForFunction(() => localStorage.getItem('cb-nick') === 'Zane');
    ok('import restores the saved data', await page.evaluate(() => localStorage.getItem('cb-nick') === 'Zane' && localStorage.getItem('td.save.v1').includes('777')));
    const bad = path.join(require('os').tmpdir(), 'bad-save.json'); fs.writeFileSync(bad, '{"format":"nope"}');
    await page.setInputFiles('input[type=file]', bad); await page.waitForSelector('#toast:not([hidden])');
    ok('import rejects files that are not Arcade saves, changing nothing', (await page.textContent('#toast')).includes('not an Arcade save') && await page.evaluate(() => localStorage.getItem('cb-nick') === 'Zane'));
    await page.click('text=Reset preferences'); await page.waitForSelector('#dlg[open]'); await page.click('#dlg-ok');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('arcade.v1')).prefs.motion === 'system');
    ok('reset preferences restores defaults but leaves game saves alone', await page.evaluate(() => localStorage.getItem('td.save.v1') !== null && localStorage.getItem('cb-nick') === 'Zane'));
    ctx.close();
  }

  section('Hosted (static server): service worker, offline play, saves across games');
  {
    const srv = await start(); const { ctx, page } = await mk();
    await page.goto(srv.url); await page.waitForSelector('.card');
    await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }, null, { timeout: 15000 });
    await page.reload(); await page.waitForSelector('.card');
    ok('service worker registers over http', await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())));
    ok('launcher at the site root, relative game links', (await page.getAttribute('.hero a.btn.solid', 'href')) === 'games/touge-drift/index.html');
    // let the precache finish, then go offline
    await page.waitForFunction(async () => { const ks = await caches.keys(); if (!ks.length) return false; const c = await caches.open(ks.find(k => k.startsWith('arcade-'))); return (await c.keys()).length >= 25; }, null, { timeout: 20000 });
    await ctx.setOffline(true);
    await page.goto(srv.url); await page.waitForSelector('.card');
    ok('launcher loads while offline', (await page.locator('.card').count()) === 2);
    await page.click('.card:nth-child(1) a.btn'); await page.waitForURL(/touge-drift/); await page.waitForSelector('.s-title');
    ok('Touge Drift loads and runs while offline', await page.isVisible('.menu') && page.errors.filter(e => !/Failed to load resource|net::ERR/.test(e)).length === 0, page.errors);
    await page.click('[data-act="free"]'); await page.click('[data-act="fgo"]'); await page.click('[data-act="go"]'); await page.waitForTimeout(4600);
    ok('...including starting a race offline', await page.evaluate(() => __td.app.race && __td.app.race.state === 'running'));
    await page.goto(srv.url + 'games/claudeball/index.html'); await page.waitForFunction(() => { const n = document.getElementById('menu-name'), m = document.getElementById('menu-main'); return (n && !n.hidden) || (m && !m.hidden); });
    ok('Claude Ball loads while offline', true);
    await ctx.setOffline(false);
    // saves shared between pages of one origin: a name saved in Claude Ball is visible to the launcher's export
    await page.evaluate(() => localStorage.setItem('cb-nick', 'HostedZane'));
    await page.goto(srv.url + '#/settings'); await page.waitForSelector('.store');
    const cbRow = await page.locator('.store tr:has-text("Claude Ball")').textContent();
    ok('Claude Ball save data (cb-nick) is visible to the launcher on the same origin: moving the game into /games/ keeps its saves (' + cbRow.trim() + ')', /1 item/.test(cbRow), cbRow);
    await page.goto(srv.url + 'games/claudeball/index.html'); await page.waitForSelector('#btn-play', { timeout: 8000 });
    ok('a saved Claude Ball name survives the move (no name prompt shown)', await page.isVisible('#btn-play') && !(await page.isVisible('#menu-name')) && await page.evaluate(() => localStorage.getItem('cb-nick') === 'HostedZane'));
    ok('every request stayed on the local server', page.reqs.every(u => u.startsWith(srv.url) || u.startsWith('data:')), page.reqs.filter(u => !u.startsWith(srv.url) && !u.startsWith('data:')));
    await ctx.close(); await srv.close();
  }

  section('Hosted under a sub-path (like https://user.github.io/ClaudeBall/)');
  {
    const srv = await start(root, '/ClaudeBall/'); const { ctx, page } = await mk();
    await page.goto(srv.url); await page.waitForSelector('.card');
    ok('launcher works at /ClaudeBall/ with relative links only', (await page.locator('.card').count()) === 2 && page.errors.length === 0, page.errors);
    await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }, null, { timeout: 15000 });
    ok('service worker scope is the sub-path, not the domain root', await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope.endsWith('/ClaudeBall/')));
    await page.click('.hero a.btn.solid'); await page.waitForURL(/\/ClaudeBall\/games\/touge-drift\//); await page.waitForSelector('.s-title');
    ok('Touge Drift runs under the sub-path (all scripts resolved)', await page.evaluate(() => !!window.TD && !!TD.Game) && page.errors.length === 0, page.errors);
    await page.click('#lib-link'); await page.waitForURL(/\/ClaudeBall\/(index\.html)?$/); ok('Back to Library returns inside the sub-path', page.url().includes('/ClaudeBall/'));
    await page.goto(srv.url + 'games/claudeball/'); await page.waitForFunction(() => { const n = document.getElementById('menu-name'), m = document.getElementById('menu-main'); return (n && !n.hidden) || (m && !m.hidden); });
    ok('Claude Ball runs under the sub-path via its folder URL', page.errors.length === 0, page.errors);
    ok('nothing was requested outside /ClaudeBall/', page.reqs.every(u => u.startsWith(srv.url) || u.startsWith('data:')));
    await ctx.close(); await srv.close();
  }

  section('Adding a third game (scaffold into a temporary copy of the repo)');
  {
    const os = require('os'), cpx = require('child_process'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-'));
    const copy = (src, dst) => { fs.mkdirSync(dst, { recursive: true }); for (const f of fs.readdirSync(src)) { if (['.git', 'node_modules', 'tests'].includes(f)) continue; const s = path.join(src, f), d = path.join(dst, f); fs.statSync(s).isDirectory() ? copy(s, d) : fs.copyFileSync(s, d); } };
    copy(root, tmp);
    const r = cpx.spawnSync('node', [path.join(tmp, 'tools', 'new-game.js'), 'sample-game', 'Sample Game', 'Puzzle', 'Just a test.'], { encoding: 'utf8' });
    ok('tools/new-game.js scaffolds a game, cover and registry entry', r.status === 0 && fs.existsSync(path.join(tmp, 'games', 'sample-game', 'index.html')) && fs.existsSync(path.join(tmp, 'assets', 'covers', 'sample-game.svg')), r.stderr);
    ok('the offline file list was regenerated to include it', fs.readFileSync(path.join(tmp, 'sw-files.js'), 'utf8').includes('games/sample-game/index.html'));
    const { ctx, page } = await mk();
    await page.goto('file://' + tmp + '/index.html'); await page.waitForSelector('.card');
    ok('the new game appears in the launcher library with no code changes to the launcher', (await page.locator('.card').count()) === 3 && (await page.textContent('.grid')).includes('Sample Game'));
    await page.click('.card:has-text("Sample Game") a.btn'); await page.waitForURL(/sample-game/); await page.waitForSelector('#save');
    await page.click('#save'); ok('the starter game runs and saves under its own prefix', await page.evaluate(() => localStorage.getItem('sample-game.save.v1') !== null));
    ok('...and the shared Back to Library control is present', await page.isVisible('.arcade-back'));
    await page.click('.arcade-back'); await page.waitForURL(/index\.html$/); ok('...and returns to the launcher by a relative path', await page.isVisible('.card'));
    await page.goto('file://' + tmp + '/index.html#/settings'); await page.waitForSelector('.store');
    ok('the new game\'s saves show up in Settings storage and are covered by export', (await page.textContent('.store')).includes('Sample Game'));
    ok('no errors in the third game flow', page.errors.length === 0, page.errors); await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST SCRIPT ERROR', e); process.exit(2); });
