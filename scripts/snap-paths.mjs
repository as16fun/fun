#!/usr/bin/env node
// Authoring helper: makes story paths follow real streets, bus roads or tram tracks.
//
// In public/data/story.json, give a path location a few waypoints and say what to snap to:
//
//   "location": { "type": "path", "snap": "streets", "via": [[lon, lat], [lon, lat], …] }
//   "location": { "type": "paths", "snap": "streets", "via": [[[lon, lat], …], [[lon, lat], …]] }
//   "location": { "type": "path", "snap": "bus", "via": [...] }    ← only roads a bus can drive
//   "location": { "type": "path", "snap": "tram", "via": [...] }
//   "location": { "type": "area", "fromOsm": "w37746636" }   ← copy an OSM area outline
//
// `npm run snap-paths` routes between the waypoints over the OSM network in public/data
// (WGS84 GeoJSON, projected to local metres here so distances are real) and writes the
// result into "coordinates". Re-run it whenever you move a waypoint.
// The browser only ever reads "coordinates", so this never runs at runtime.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProjection } from './geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public/data');
const read = async (f) => JSON.parse(await fs.readFile(path.join(DATA, f), 'utf8'));

const meta = await read('meta.json');
const proj = makeProjection(meta.origin);
const storyFile = path.join(DATA, 'story.json');
const story = JSON.parse(await fs.readFile(storyFile, 'utf8'));
const roads = await read('roads.geojson');
const rail = await read('rail.geojson');

// Prefer proper streets over cut-throughs so marches look like marches.
const PENALTY = { footway: 1.7, path: 1.8, cycleway: 1.5, steps: 3, service: 1.4, construction: 1.2 };
const toXY = ([lon, lat]) => proj.project(lon, lat);
const streets = buildGraph(roads.features.filter((f) => f.geometry.type === 'LineString'), (p) => PENALTY[p.highway] ?? 1);
const tram = buildGraph(rail.features, () => 1);
// Buses stay on carriageways and bus lanes: no pedestrian streets, cycle paths or footways.
const BUS_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'unclassified', 'residential', 'busway', 'road']);
const bus = buildGraph(roads.features.filter((f) => f.geometry.type === 'LineString' && BUS_ROADS.has(f.properties.highway)), () => 1);

let changed = 0;
for (const ev of story.events) {
  const loc = ev.location;
  if (!loc) continue;
  if (loc.fromOsm) {
    const src = [...roads.features, ...(await read('green.geojson')).features, ...(await read('buildings.geojson')).features]
      .find((f) => f.properties.id === loc.fromOsm && f.geometry.type === 'Polygon');
    if (!src) throw new Error(`${ev.id}: OSM feature ${loc.fromOsm} not found in public/data`);
    loc.coordinates = simplify(src.geometry.coordinates[0].map(toXY), 0.6).map(toLonLat);
    changed++;
    console.log(`${ev.id}: area from ${loc.fromOsm} (${loc.coordinates.length} pts)`);
    continue;
  }
  if (!loc.via || !loc.snap) continue;
  const graph = loc.snap === 'tram' ? tram : loc.snap === 'bus' ? bus : streets;
  const route = (via) => {
    const pts = via.map(([lon, lat]) => proj.project(lon, lat));
    let out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = nearestNode(graph, pts[i]), b = nearestNode(graph, pts[i + 1]);
      let seg = shortestPath(graph, a, b);
      // Squares are often mapped as separate lines that don't touch. When two close waypoints
      // only connect through a long detour (or not at all), walk straight across instead.
      const direct = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
      if (direct < 60 && (!seg || length(seg) > direct * 3 + 30)) seg = [a.p, b.p];
      if (!seg) throw new Error(`${ev.id}: no ${loc.snap} route between waypoints ${i} and ${i + 1}`);
      out = out.length ? out.concat(seg.slice(1)) : seg;
    }
    return simplify(out, 0.35).map(toLonLat);
  };
  if (loc.type === 'paths') loc.coordinates = loc.via.map(route);
  else loc.coordinates = route(loc.via);
  changed++;
  const n = loc.type === 'paths' ? loc.coordinates.map((c) => c.length).join('+') : loc.coordinates.length;
  console.log(`${ev.id}: snapped to ${loc.snap} (${n} pts)`);
}

await fs.writeFile(storyFile, JSON.stringify(story, null, 2) + '\n');
console.log(`✔ Updated ${changed} locations in ${path.relative(ROOT, storyFile)}`);

// ── helpers ───────────────────────────────────────────────────────────────────
function length(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return d;
}
function toLonLat([x, y]) {
  const [lon, lat] = proj.unproject(x, y);
  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
}

function buildGraph(features, weightOf) {
  const nodes = new Map(); // key -> { p, edges: [{ to, w }] }
  const key = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const node = (p) => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { k, p, edges: [] });
    return nodes.get(k);
  };
  for (const f of features) {
    const c = f.geometry.coordinates.map(toXY);
    const factor = weightOf(f.properties);
    for (let i = 0; i < c.length - 1; i++) {
      const a = node(c[i]), b = node(c[i + 1]);
      const w = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) * factor;
      a.edges.push({ to: b, w });
      b.edges.push({ to: a, w });
    }
  }
  return nodes;
}

function nearestNode(graph, [x, y]) {
  let best = null, bd = Infinity;
  for (const n of graph.values()) {
    const d = (n.p[0] - x) ** 2 + (n.p[1] - y) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  if (Math.sqrt(bd) > 40) console.warn(`  ! waypoint ${x.toFixed(0)},${y.toFixed(0)} is ${Math.sqrt(bd).toFixed(0)} m from the network`);
  return best;
}

function shortestPath(graph, start, goal) {
  // Dijkstra with a simple binary heap.
  const dist = new Map([[start.k, 0]]);
  const prev = new Map();
  const heap = [[0, start]];
  const push = (item) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, n] = pop();
    if (n === goal) break;
    if (d > (dist.get(n.k) ?? Infinity)) continue;
    for (const { to, w } of n.edges) {
      const nd = d + w;
      if (nd < (dist.get(to.k) ?? Infinity)) {
        dist.set(to.k, nd);
        prev.set(to.k, n);
        push([nd, to]);
      }
    }
  }
  if (!dist.has(goal.k)) return null;
  const out = [goal.p];
  for (let n = goal; prev.has(n.k);) {
    n = prev.get(n.k);
    out.push(n.p);
  }
  return out.reverse();
}

/** Douglas–Peucker simplification in metres. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const sq = tolerance * tolerance;
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
    if (max > sq) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
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
