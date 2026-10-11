// Re-tints the baked journey lighting images (shadow + district fade) from one background and
// shadow colour to another without re-running the Overpass pipeline.
// usage: node scripts/recolor-lighting.mjs <from-bg> <from-shadow> <to-bg> <to-shadow> <png…>
import fs from 'node:fs';
import zlib from 'node:zlib';

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const [fromBg, fromSh, toBg, toSh] = process.argv.slice(2, 6).map(hex);
const files = process.argv.slice(6);

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4);
  len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, cr]);
};

for (const file of files) {
  const png = fs.readFileSync(file);
  let o = 8, ihdr, idat = [];
  while (o < png.length) {
    const len = png.readUInt32BE(o), type = png.toString('ascii', o + 4, o + 8), data = png.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') ihdr = Buffer.from(data);
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), stride = w * 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? px[y * stride + x - 4] : 0;
      const up = y ? px[(y - 1) * stride + x] : 0;
      const ul = y && x >= 4 ? px[(y - 1) * stride + x - 4] : 0;
      const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      px[y * stride + x] = (v + [0, left, up, (left + up) >> 1, paeth][f]) & 0xff;
    }
  }
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const wB = Math.min(1, Math.max(0, (px[i] - fromSh[0]) / (fromBg[0] - fromSh[0])));
    for (let c = 0; c < 3; c++) px[i + c] = Math.round(toSh[c] + wB * (toBg[c] - toSh[c]));
  }
  const out = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    out[y * (stride + 1)] = 1;
    for (let x = 0; x < stride; x++) out[y * (stride + 1) + 1 + x] = (px[y * stride + x] - (x >= 4 ? px[y * stride + x - 4] : 0)) & 0xff;
  }
  fs.writeFileSync(file, Buffer.concat([
    png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
  console.log('recoloured', file, w + 'x' + h);
}
