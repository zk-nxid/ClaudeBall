/* Tiny static file server for tests (no dependencies). const { start } = require('./serve'); const s = await start(); s.url; await s.close(); */
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function start(dir, prefix) {
  dir = dir || root; prefix = prefix || '';
  return new Promise(res => {
    const log = [];
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (prefix) { if (!p.startsWith(prefix)) { rsp.writeHead(404); rsp.end('not found'); return; } p = p.slice(prefix.length - 1); }   // e.g. prefix '/ClaudeBall/' like a GitHub Pages project site
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dir, p); log.push(p);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('not found'); return; }
      rsp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res({ url: 'http://127.0.0.1:' + srv.address().port + (prefix || '/'), log, close: () => new Promise(r => srv.close(r)) }));
  });
}
module.exports = { start };
