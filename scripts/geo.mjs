// Shared geo helpers for the build-time data scripts.
// The runtime has its own copy of the projection in src/data/projection.js —
// both read the origin from public/data/meta.json so they always agree.

export const EARTH_RADIUS = 6378137; // WGS84 semi-major axis, metres
const DEG = Math.PI / 180;

/** Simple equirectangular projection around a local origin. Returns metres, y = north. */
export function makeProjection([lon0, lat0]) {
  const ky = EARTH_RADIUS * DEG;
  const kx = ky * Math.cos(lat0 * DEG);
  return {
    kx,
    ky,
    project: (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky],
    unproject: (x, y) => [lon0 + x / kx, lat0 + y / ky],
  };
}

/** Rounded-square ("superellipse") distance used for the district fade. */
export function districtDistance(x, y, p = 4) {
  return Math.pow(Math.pow(Math.abs(x), p) + Math.pow(Math.abs(y), p), 1 / p);
}

export function signedArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const sx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const sy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return [sx, sy];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministic string hash (cyrb53, trimmed to 32 bits) for seeding. */
export function hashString(str) {
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

/** mulberry32 PRNG — small, fast, seedable. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round2 = (v) => Math.round(v * 100) / 100;
