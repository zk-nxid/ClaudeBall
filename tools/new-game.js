/* Scaffold a new game for the platform.
 *   node tools/new-game.js <id> "<Title>" "<Genre>" ["<one-line tagline>"]
 * Creates games/<id>/index.html (a working starter that already has the Back to Library control), a cover image in
 * assets/covers/, and registers the game in games.json; then regenerates registry.js and the offline file list.
 * After that: replace the starter code, then fill in the description, controls and features in games.json. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const [id, title, genre, tagline] = process.argv.slice(2);
if (!id || !title || !genre || !/^[a-z0-9-]+$/.test(id)) { console.error('usage: node tools/new-game.js <id: a-z0-9-> "<Title>" "<Genre>" ["<tagline>"]'); process.exit(1); }
const gj = path.join(root, 'games.json'), data = JSON.parse(fs.readFileSync(gj, 'utf8'));
if (data.games.some(g => g.id === id) || fs.existsSync(path.join(root, 'games', id))) { console.error('a game called "' + id + '" already exists'); process.exit(1); }
const hue = [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 360, esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
fs.mkdirSync(path.join(root, 'games', id), { recursive: true });
fs.writeFileSync(path.join(root, 'games', id, 'index.html'), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; height: 100%; background: #0a0b0e; color: #ece8df; font-family: system-ui, sans-serif; overflow: hidden; }
    main { height: 100%; display: grid; place-items: center; text-align: center; }
    h1 { font-size: clamp(2rem, 8vw, 5rem); margin: 0 0 .3em; }
    button { font: inherit; padding: .7em 1.4em; border-radius: 10px; border: 0; background: #f2a53a; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <div>
      <h1>${esc(title)}</h1>
      <p>Replace this starter with your game. It already runs offline and has a Back to Library button.</p>
      <p><button id="save">Save a score</button> <span id="out"></span></p>
    </div>
  </main>
  <script src="../../assets/back-to-library.js"></script>
  <script>
    // Local saves: use localStorage keys that start with the prefix registered in games.json ("${id}.").
    const KEY = '${id}.save.v1';
    const out = document.getElementById('out');
    function load() { try { return JSON.parse(localStorage.getItem(KEY)) || { plays: 0 }; } catch (e) { return { plays: 0 }; } }
    document.getElementById('save').onclick = () => { const s = load(); s.plays++; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} out.textContent = 'Saved ' + s.plays + ' time(s)'; };
    out.textContent = 'Saved ' + load().plays + ' time(s)';
  </script>
</body>
</html>
`);
fs.writeFileSync(path.join(root, 'assets', 'covers', id + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,16%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},55%,8%)"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1180" cy="300" r="260" fill="hsl(${hue},70%,55%)" opacity=".18"/><circle cx="1180" cy="300" r="110" fill="hsl(${hue},70%,60%)" opacity=".35"/><text x="120" y="760" font-family="Arial Narrow, Arial, sans-serif" font-weight="800" font-size="150" fill="#ece8df" opacity=".9">${esc(title.toUpperCase())}</text></svg>\n`);
data.games.push({ id, title, tagline: tagline || 'A new game.', genre, tags: ['Offline'], featured: false, status: 'available', version: '0.1', entry: 'games/' + id + '/index.html', cover: 'assets/covers/' + id + '.svg', accent: hslHex(hue, 70, 60),
  offline: true, players: '1 player', description: 'Describe your game here (a few sentences).', modes: [{ name: 'Play', text: 'The main mode.' }], controls: [{ keys: 'Mouse', action: 'Play' }], features: ['What makes it fun'], capabilities: [], storage: { prefixes: [id + '.'], note: 'Your progress.' } });
function hslHex(h, s, l) { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); }
fs.writeFileSync(gj, JSON.stringify(data, null, 2) + '\n');
const r = cp.spawnSync('node', [path.join(__dirname, 'build-platform.js')], { stdio: 'inherit' });
if (r.status) process.exit(r.status);
console.log('\nCreated games/' + id + '/. Open index.html at the repo root and your game is in the library.\nNext: edit games.json (description, controls, features) and re-run: node tools/build-platform.js');
