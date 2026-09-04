// A dependency-free static release. Copy only files the browser actually needs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const manifestPath = path.join(root, 'qa', 'deploy-file-list.json');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'asset-map.js'), 'utf8'), context);
const files = [], size = [];
fs.mkdirSync(dist, { recursive: true });
// Remove only this builder's previous files after checking each absolute target.
if (fs.existsSync(manifestPath)) {
  for (const relative of JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files) {
    const target = path.resolve(dist, relative);
    if (!target.startsWith(dist + path.sep)) throw new Error('Invalid prior build path');
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}
function write(relative, data) {
  const target = path.resolve(dist, relative);
  if (!target.startsWith(dist + path.sep)) throw new Error('Invalid output path');
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
  files.push(relative); size.push(Buffer.byteLength(data));
}
const pages = Object.fromEntries(['index.html', 'ranking.html'].map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
for (const source of ['style.css', 'ranking.css', 'rhythm-core.js', 'asset-map.js', 'render-quality.js', 'record-config.js', 'sheets-client.js', 'leaderboard.js', 'ranking.js', 'game.js']) {
  const data = fs.readFileSync(path.join(root, source));
  const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
  const parsed = path.parse(source), output = `static/${parsed.name}.${hash}${parsed.ext}`;
  write(output, data); for (const name of Object.keys(pages)) pages[name] = pages[name].replaceAll(`"${source}"`, `"${output}"`);
}
for (const asset of Object.values(context.window.HwarakAssets)) write(asset, fs.readFileSync(path.join(root, asset)));
write('assets/kakao-share-20260904.jpg', fs.readFileSync(path.join(root, 'assets/kakao-share-20260904.jpg')));
for (const [name, html] of Object.entries(pages)) write(name, html);
// Cloudflare Pages-compatible headers; other hosts can apply the same policy.
write('_headers', '/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/assets/optimized/*\n  Cache-Control: public, max-age=31536000, immutable\n/static/*\n  Cache-Control: public, max-age=31536000, immutable\n');
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
const report = { files, bytes: size.reduce((a, b) => a + b), builtAt: new Date().toISOString() };
fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2));
console.log(`Built ${files.length} files, ${(report.bytes / 1e6).toFixed(2)} MB in dist/`);
