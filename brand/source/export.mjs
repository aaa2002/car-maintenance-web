// Exports PNG/ICO renditions of the brand SVGs and copies the files the app serves.
// Usage from the repo root: node brand/source/export.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const R = path.resolve(process.env.REPO || '.'), B = path.join(R, 'brand'), S = path.join(B, 'svg');
const svg = (n) => fs.readFileSync(path.join(S, n + '.svg'));
const mk = (d) => fs.mkdirSync(d, { recursive: true });
// Rasterise at 2x the target size, derived from the viewBox (SVG units are 72 dpi to sharp).
const png = (n, opts) => {
  const [, , vw, vh] = svg(n).toString().match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const scale = opts.width ? opts.width / vw : opts.height / vh;
  return sharp(svg(n), { density: Math.min(72 * scale * 2, 2400) }).resize(opts).png({ compressionLevel: 9 });
};

function ico(buffers) {
  // ICO container with PNG-compressed entries (supported by every current browser and OS).
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(buffers.length, 4);
  const dir = Buffer.alloc(16 * buffers.length); let offset = 6 + dir.length;
  buffers.forEach(({ size, data }, i) => {
    const o = i * 16; dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...buffers.map((b) => b.data)]);
}

(async () => {
  mk(path.join(B, 'png', 'logo')); mk(path.join(B, 'png', 'app-icon')); mk(path.join(B, 'png', 'favicon'));
  const lockups = fs.readdirSync(S).map((f) => f.replace('.svg', '')).filter((n) => /logo|wordmark|mark/.test(n) && !/app-icon|favicon|maskable|apple/.test(n));
  for (const n of lockups) {
    // Lockups at 600px tall, the mark at 1024px wide: big enough for slides and print previews.
    const opts = /mark/.test(n) && !/wordmark/.test(n) ? { width: 1024 } : { height: 600 };
    await png(n, opts).toFile(path.join(B, 'png', 'logo', n + '.png'));
  }
  for (const n of ['vehix-app-icon-blue', 'vehix-app-icon-dark', 'vehix-app-icon-gradient', 'vehix-app-icon-mono', 'vehix-apple-touch-icon', 'vehix-maskable-icon'])
    for (const size of [1024, 512, 192])
      await png(n, { width: size }).toFile(path.join(B, 'png', 'app-icon', `${n}-${size}.png`));
  const favs = [];
  for (const size of [16, 32, 48, 64, 128, 256]) {
    const data = await png(size <= 48 ? 'vehix-favicon-small' : 'vehix-favicon', { width: size }).toBuffer();
    fs.writeFileSync(path.join(B, 'png', 'favicon', `vehix-favicon-${size}.png`), data);
    if (size <= 48) favs.push({ size, data });
  }
  fs.writeFileSync(path.join(B, 'vehix-favicon.ico'), ico(favs));
  // Social share card: horizontal dark lockup on the sign-in navy.
  const logo = await png('vehix-logo-horizontal-dark', { width: 760 }).toBuffer();
  const meta = await sharp(logo).metadata();
  const og = sharp({ create: { width: 1200, height: 630, channels: 4, background: '#08142C' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><radialGradient id="g" cx="80%" cy="0%" r="80%"><stop offset="0" stop-color="#1F55D6" stop-opacity=".35"/><stop offset="1" stop-color="#1F55D6" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="url(#g)"/></svg>') },
      { input: logo, left: Math.round((1200 - meta.width) / 2), top: Math.round((630 - meta.height) / 2) }]);
  await og.png({ compressionLevel: 9 }).toFile(path.join(B, 'png', 'vehix-og-image.png'));

  // Files the app serves (Next.js metadata conventions + PWA manifest icons).
  const app = path.join(R, 'src', 'app'); const icons = path.join(R, 'public', 'icons'); mk(icons);
  // The browser tab uses the dark app icon.
  const tab = [];
  for (const size of [16, 32, 48]) tab.push({ size, data: await png('vehix-app-icon-dark', { width: size }).toBuffer() });
  fs.writeFileSync(path.join(app, 'favicon.ico'), ico(tab));
  fs.copyFileSync(path.join(S, 'vehix-app-icon-dark.svg'), path.join(app, 'icon.svg'));
  await png('vehix-apple-touch-icon', { width: 180 }).toFile(path.join(app, 'apple-icon.png'));
  fs.copyFileSync(path.join(B, 'png', 'vehix-og-image.png'), path.join(app, 'opengraph-image.png'));
  fs.copyFileSync(path.join(B, 'png', 'app-icon', 'vehix-app-icon-blue-192.png'), path.join(icons, 'icon-192.png'));
  fs.copyFileSync(path.join(B, 'png', 'app-icon', 'vehix-app-icon-blue-512.png'), path.join(icons, 'icon-512.png'));
  fs.copyFileSync(path.join(B, 'png', 'app-icon', 'vehix-maskable-icon-512.png'), path.join(icons, 'maskable-512.png'));
  console.log('done');
})();
