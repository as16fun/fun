#!/usr/bin/env node
// Build-time: a light Europe base map for the journey page, from Natural Earth (public domain).
//
//   npm run data:europe
//
// Downloads 1:10m land, land borders, lakes, rivers and urban areas, clips them to a
// Europe box, simplifies them and writes one file: public/journey/europe.geojson
// (each feature has properties.layer = land | border | lake | river | urban | country; the Netherlands and Italy are outlined on the map).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts/.cache/natural-earth');
const OUT = path.join(ROOT, 'public/journey/europe.geojson');
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const BOX = [-24, 28, 42, 66]; // w, s, e, n — wider than any camera view on the page

// The camera only gets close to the ground along the Macerata–Eindhoven–Den Haag corridor,
// so fine detail (urban areas, small lakes) is kept there and dropped elsewhere.
const CORRIDOR = [1.5, 41.5, 16.5, 53.8];
const SOURCES = [
  { file: 'ne_10m_land', layer: 'land', tol: 0.005 },
  { file: 'ne_10m_admin_0_boundary_lines_land', layer: 'border', tol: 0.004 },
  { file: 'ne_10m_lakes', layer: 'lake', tol: 0.003, box: CORRIDOR },
  { file: 'ne_10m_rivers_lake_centerlines', layer: 'river', tol: 0.003, box: CORRIDOR },
  { file: 'ne_10m_admin_0_countries', layer: 'country', tol: 0.002, filter: (p) => ['Netherlands', 'Italy'].includes(p.ADMIN) },
  { file: 'ne_10m_urban_areas', layer: 'urban', tol: 0.0015, box: CORRIDOR, minArea: 2e-5 },
];

await fs.mkdir(CACHE, { recursive: true });
const features = [];
for (const src of SOURCES) {
  const fc = await load(src.file);
  let kept = 0;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (src.filter && !src.filter(f.properties))) continue;
    const parts = g.type.startsWith('Multi') ? g.coordinates : [g.coordinates];
    const box = src.box ?? BOX;
    if (g.type.endsWith('Polygon')) {
      const polys = parts
        .map((poly) => poly.map((ring) => clipRing(ring, box)).filter((r) => r.length >= 4))
        .filter((poly) => poly.length && ringArea(poly[0]) > (src.minArea ?? 1e-6))
        .map((poly) => poly.map((ring) => closeRing(round(simplify(ring, src.tol)))).filter((r) => r.length >= 4))
        .filter((poly) => poly.length);
      if (!polys.length) continue;
      features.push(feature(src.layer, polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }, f.properties, src));
      kept++;
    } else {
      const lines = parts.flatMap((line) => clipLine(line, box)).map((l) => round(simplify(l, src.tol))).filter((l) => l.length >= 2);
      if (!lines.length) continue;
      features.push(feature(src.layer, lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines }, f.properties, src));
      kept++;
    }
  }
  console.log(`${src.layer.padEnd(7)} ${kept} features`);
}
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify({
  type: 'FeatureCollection',
  'dispatch:attribution': 'Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com (public domain).',
  features,
}));
console.log(`✔ Wrote ${path.relative(ROOT, OUT)} ${((await fs.stat(OUT)).size / 1024) | 0} KB`);

// ── helpers ───────────────────────────────────────────────────────────────────
async function load(file) {
  const cached = path.join(CACHE, `${file}.geojson`);
  try {
    return JSON.parse(await fs.readFile(cached, 'utf8'));
  } catch { /* not cached yet */ }
  console.log(`Downloading ${file} …`);
  const res = await fetch(`${BASE}/${file}.geojson`, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) {
    console.error(`✖ Could not download ${file} (HTTP ${res.status}). Natural Earth data is needed for the Europe base map.`);
    process.exit(2);
  }
  const text = await res.text();
  await fs.writeFile(cached, text);
  return JSON.parse(text);
}

function feature(layer, geometry, p, src) {
  const props = { layer };
  if (layer === 'river') props.rank = p.scalerank ?? p.min_zoom ?? 10;
  if (layer === 'lake') props.rank = p.scalerank ?? 10;
  if (layer === 'country') props.name = p.ADMIN;
  if (layer === 'border') props.rank = p.min_zoom ?? 0;
  void src;
  return { type: 'Feature', properties: props, geometry };
}

function round(pts) {
  return pts.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
}
function closeRing(r) {
  const a = r[0], b = r[r.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
}
function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a / 2);
}

/** Sutherland–Hodgman clip of a ring against an axis-aligned box. */
function clipRing(ring, [w, s, e, n]) {
  const edges = [
    [(p) => p[0] >= w, (a, b) => inter(a, b, 0, w)],
    [(p) => p[0] <= e, (a, b) => inter(a, b, 0, e)],
    [(p) => p[1] >= s, (a, b) => inter(a, b, 1, s)],
    [(p) => p[1] <= n, (a, b) => inter(a, b, 1, n)],
  ];
  let out = ring.slice(0, -1);
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) return [];
  }
  return [...out, out[0]];
}
function inter(a, b, axis, v) {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return axis === 0 ? [v, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), v];
}

/** Splits a line into the runs of vertices inside the box. */
function clipLine(line, [w, s, e, n]) {
  const inBox = ([x, y]) => x >= w && x <= e && y >= s && y <= n;
  const runs = [];
  let cur = [];
  for (const p of line) {
    if (inBox(p)) cur.push(p);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function simplify(points, tol) {
  if (points.length < 4) return points;
  const sq = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDistSq(points[i], points[a], points[b]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > sq) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
function segDistSq([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
}
