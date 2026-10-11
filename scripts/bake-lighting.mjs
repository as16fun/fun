// Bakes the "clay render" lighting that MapLibre cannot do at runtime:
//   • soft sun shadows cast by buildings and trees
//   • contact shading (ambient occlusion) around building bases
//   • the soft fade of the district edge into the background
// into a single RGBA PNG that the map draws as an image source under the extrusions.
// Pure JS (scanline fill + box blur + zlib) so the pipeline has no native dependencies.

import zlib from 'node:zlib';
import { districtDistance } from './geo.mjs';

/**
 * @param {object} o
 * @param {number} o.half        half-size of the square raster in metres (centred on the origin)
 * @param {number} o.size        raster size in pixels
 * @param {Array}  o.buildings   [{ rings: [[[x,y],…],…], h }]  local metres, y = north
 * @param {Array}  o.trees       [{ x, y, h, crown }]
 * @param {object} o.sun         { azimuth (deg, clockwise from north, direction the light comes FROM), elevation (deg) }
 * @param {object} o.fade        { start, end } superellipse distances in metres
 * @param {number[]} o.bg        background RGB 0–255
 * @param {number[]} o.shadow    shadow RGB 0–255
 */
export function bakeLighting(o) {
  const { half, size } = o;
  const mpp = (2 * half) / size; // metres per pixel
  const toPx = ([x, y]) => [(x + half) / mpp, (half - y) / mpp];

  // Shadow direction: away from the sun, length = h / tan(elevation).
  const az = (o.sun.azimuth * Math.PI) / 180;
  const k = 1 / Math.tan((o.sun.elevation * Math.PI) / 180);
  const dir = [-Math.sin(az) * k, -Math.cos(az) * k]; // metres of shadow per metre of height (x east, y north)

  const footprint = new Float32Array(size * size);
  const cast = new Float32Array(size * size);
  const treeCast = new Float32Array(size * size);

  for (const b of o.buildings) {
    const rings = b.rings.map((r) => r.map(toPx));
    fillPolygon(footprint, size, rings, 1);
    // The shadow of an extruded prism is the union of the translated roof and one quad per wall.
    const off = [dir[0] * b.h / mpp, -dir[1] * b.h / mpp];
    const moved = rings.map((r) => r.map(([x, y]) => [x + off[0], y + off[1]]));
    fillPolygon(cast, size, moved, 1);
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], c = r[(i + 1) % r.length];
        fillPolygon(cast, size, [[a, c, [c[0] + off[0], c[1] + off[1]], [a[0] + off[0], a[1] + off[1]]]], 1);
      }
    }
  }
  for (const t of o.trees) {
    const [px, py] = toPx([t.x, t.y]);
    const lift = t.h * 0.62; // crown centre
    const cx = px + (dir[0] * lift) / mpp, cy = py - (dir[1] * lift) / mpp;
    fillDisc(treeCast, size, cx, cy, (t.crown * 0.5) / mpp, 1);
  }

  // Soften: shadows get a small penumbra, contact shading a wider falloff.
  const castSoft = blur(cast, size, Math.max(1, Math.round(0.9 / mpp)), 3);
  const treeSoft = blur(treeCast, size, Math.max(1, Math.round(1.6 / mpp)), 3);
  const ao = blur(footprint, size, Math.max(1, Math.round(3.2 / mpp)), 3);

  const out = Buffer.alloc(size * size * 4);
  const [br, bg, bb] = o.bg, [sr, sg, sb] = o.shadow;
  for (let j = 0; j < size; j++) {
    const y = half - (j + 0.5) * mpp;
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) * mpp - half;
      const idx = j * size + i;
      const aSh = 0.17 * castSoft[idx] + 0.11 * treeSoft[idx] * (1 - castSoft[idx]);
      const aAo = 0.2 * Math.min(1, ao[idx] * 1.6) * (1 - footprint[idx]);
      const as = 1 - (1 - aSh) * (1 - aAo);
      const af = smoothstep(o.fade.start, o.fade.end, districtDistance(x, y));
      const A = 1 - (1 - af) * (1 - as);
      const p = idx * 4;
      if (A <= 0.0005) continue;
      // Straight (non-premultiplied) colour so that "over" compositing gives
      // fade(shadow(ground)): C·A = (1-af)·as·S + af·B
      const wS = ((1 - af) * as) / A, wB = af / A;
      out[p] = clamp255(wS * sr + wB * br);
      out[p + 1] = clamp255(wS * sg + wB * bg);
      out[p + 2] = clamp255(wS * sb + wB * bb);
      out[p + 3] = clamp255(A * 255);
    }
  }
  return encodePNG(out, size, size);
}

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Even–odd scanline fill of polygon rings (pixel coords), max-combined into the mask. */
function fillPolygon(mask, size, rings, value) {
  let minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (const [, y] of r) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(size - 1, Math.ceil(maxY));
  const xs = [];
  for (let j = y0; j <= y1; j++) {
    const sy = j + 0.5;
    xs.length = 0;
    for (const r of rings) {
      for (let i = 0, n = r.length; i < n; i++) {
        const [ax, ay] = r[i], [bx, by] = r[(i + 1) % n];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(size - 1, Math.floor(xs[k + 1] - 0.5));
      for (let i = a; i <= b; i++) {
        const idx = j * size + i;
        if (mask[idx] < value) mask[idx] = value;
      }
    }
  }
}

function fillDisc(mask, size, cx, cy, r, value) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(size - 1, Math.ceil(cy + r));
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) {
        const idx = j * size + i;
        if (mask[idx] < value) mask[idx] = value;
      }
    }
  }
}

/** Repeated separable box blur ≈ gaussian. */
function blur(src, size, radius, passes) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const w = 2 * radius + 1;
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < size; j++) {
      const row = j * size;
      let acc = 0;
      for (let i = -radius; i <= radius; i++) acc += a[row + Math.min(size - 1, Math.max(0, i))];
      for (let i = 0; i < size; i++) {
        b[row + i] = acc / w;
        acc += a[row + Math.min(size - 1, i + radius + 1)] - a[row + Math.max(0, i - radius)];
      }
    }
    for (let i = 0; i < size; i++) {
      let acc = 0;
      for (let j = -radius; j <= radius; j++) acc += b[Math.min(size - 1, Math.max(0, j)) * size + i];
      for (let j = 0; j < size; j++) {
        a[j * size + i] = acc / w;
        acc += b[Math.min(size - 1, j + radius + 1) * size + i] - b[Math.max(0, j - radius) * size + i];
      }
    }
  }
  return a;
}

// ── Minimal PNG encoder (RGBA 8-bit) ──────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // Filter type 1 (Sub) compresses smooth gradients well.
    const o = y * (stride + 1);
    raw[o] = 1;
    for (let x = 0; x < stride; x++) {
      const v = rgba[y * stride + x];
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      raw[o + 1 + x] = (v - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
