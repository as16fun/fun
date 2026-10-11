// Runtime geometry helpers. Story data is WGS84; anything that needs distances
// (path lengths, offsets, hex grids) uses a local equirectangular frame in metres.

const DEG = Math.PI / 180;
const R = 6378137;

export function makeLocal([lon0, lat0]) {
  const ky = R * DEG;
  const kx = ky * Math.cos(lat0 * DEG);
  return {
    toXY: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLL: ([x, y]) => [lon0 + x / kx, lat0 + y / ky],
  };
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Cumulative-length representation of a polyline in metres. */
export function measurePath(xy) {
  const cum = [0];
  for (let i = 1; i < xy.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  }
  return { xy, cum, length: cum[cum.length - 1] };
}

/** Point, unit tangent and normal at distance d along a measured path. */
export function pointAlong(path, d) {
  const { xy, cum, length } = path;
  if (xy.length === 1) return { p: xy[0], t: [1, 0], n: [0, 1] };
  const dd = clamp(d, 0, length);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= dd) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const f = (dd - cum[lo]) / seg;
  const a = xy[lo], b = xy[hi];
  const tx = (b[0] - a[0]) / seg, ty = (b[1] - a[1]) / seg;
  return { p: [lerp(a[0], b[0], f), lerp(a[1], b[1], f)], t: [tx, ty], n: [-ty, tx] };
}

export function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToRing([x, y], ring) {
  let best = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % n];
    const dx = bx - ax, dy = by - ay;
    const l = dx * dx + dy * dy;
    const t = l ? clamp(((x - ax) * dx + (y - ay) * dy) / l, 0, 1) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

/** Bounding box [w, s, e, n] of any nested lon/lat coordinate array. */
export function bboxOf(coords) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]);
      b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]);
    } else c.forEach(walk);
  };
  walk(coords);
  return b;
}

/** Regular polygon around a local point, returned as a closed lon/lat ring. */
export function circleRing(local, [x, y], r, sides = 10, rotation = 0) {
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    ring.push(local.toLL([x + Math.cos(a) * r, y + Math.sin(a) * r]));
  }
  ring.push(ring[0]);
  return ring;
}
