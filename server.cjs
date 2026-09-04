const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ROOT = process.argv.includes('--dist') ? path.join(__dirname, 'dist') : __dirname;
const PORT = Number(process.env.PORT) || 4173;
const files = new Set(['index.html', 'ranking.html', 'ranking.css', 'ranking.js', 'record-config.js', 'sheets-client.js', 'style.css', 'game.js', 'rhythm-core.js', 'asset-map.js', 'render-quality.js', 'leaderboard.js', 'assets/kakao-share-20260904.jpg', 'assets/neon-festival.png', 'assets/opening.mp4', 'assets/title-logo.png']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let relative;
  try { relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html'; }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const isCharacter = /^character\/[a-zA-Z0-9_ ()-]+\.png$/.test(relative);
  const isVersioned = /^(?:assets\/optimized|static)\/[a-zA-Z0-9_-]+\.[a-f0-9]{12}\.(?:webp|mp4|js|css)$/.test(relative);
  if (!files.has(relative) && !isCharacter && !isVersioned) { res.writeHead(404); return res.end('Not found'); }
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const etag = isVersioned ? `"${path.basename(file).split('.').at(-2)}"` : `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
    const modified = stat.mtime.toUTCString();
    const headers = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': isVersioned ? 'public, max-age=31536000, immutable' : 'no-cache',
      'ETag': etag, 'Last-Modified': modified, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    const tagMatches = req.headers['if-none-match']?.split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''));
    const dateMatches = !req.headers['if-none-match'] && req.headers['if-modified-since'] && Date.parse(req.headers['if-modified-since']) >= Math.floor(stat.mtimeMs / 1000) * 1000;
    if (tagMatches || dateMatches) { res.writeHead(304, headers); return res.end(); }
    let start = 0, end = stat.size - 1, status = 200;
    // Mobile video players use byte ranges for metadata, seeking and playback.
    if (req.headers.range && req.method === 'GET' && (!req.headers['if-range'] || req.headers['if-range'] === etag || req.headers['if-range'] === modified)) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (match && (match[1] || match[2])) {
        if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }); return res.end();
        }
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      }
    }
    res.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') res.end();
    else { const stream = fs.createReadStream(file, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
  });
});
server.on('error', err => { console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Set PORT to another port.` : err); process.exitCode = 1; });
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Hwarak game: http://localhost:${PORT}`);
  for (const interfaces of Object.values(os.networkInterfaces())) for (const item of interfaces || []) {
    if (item.family === 'IPv4' && !item.internal) console.log(`Same Wi-Fi: http://${item.address}:${PORT}`);
  }
});
