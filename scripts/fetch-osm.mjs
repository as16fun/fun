#!/usr/bin/env node
// Build-time data pipeline for Dispatch.
//
//   OpenStreetMap (Overpass API) ──► WGS84 GeoJSON + baked lighting image in public/data/
//
// Coordinates are kept in lon/lat because MapLibre consumes WGS84. A simple equirectangular
// projection to local metres is still used here, at build time, for everything that needs
// distances: footprint areas, heights, the district fade, the intro wave and the shadow bake.
//
// Run once:              npm run data
// Re-process the cache:  npm run data:offline
// Use your own export:   npm run data -- --from-file path/to/overpass-export.json
//
// Nothing here runs in the browser. The app only reads the static files written below.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeProjection, districtDistance, signedArea, centroid, pointInRing,
  hashString, seededRandom, round2,
} from './geo.mjs';
import { bakeLighting } from './bake-lighting.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts/.cache');

// ── District presets ──────────────────────────────────────────────────────────
// `npm run data -- --district <name>`; the default is the Storyline prototype district.
// origin: centre of the fetched square · core/fetch: half-sizes in metres ·
// fade: superellipse (p=4) distances where the city melts into the background ·
// focus: where the intro wave starts.
const DISTRICTS = {
  // Storyline (the newsroom prototype): central Eindhoven, from 18 Septemberplein and the Markt
  // down to Stratumseind and the Stadhuis.
  storyline: {
    name: 'Central Eindhoven, NL',
    origin: [5.48000, 51.43800], core: 400, fetch: 620, fade: { start: 460, end: 600 },
    focus: [5.47872, 51.43939], // Markt
    out: 'public/data',
  },
  // Journey: central The Hague (Den Haag), around the Binnenhof. Den Haag was remote work, so the
  // journey shows the city, not an address.
  hague: {
    name: 'Central The Hague (Den Haag), NL',
    origin: [4.31167, 52.08073], core: 360, fetch: 560, fade: { start: 420, end: 545 },
    focus: [4.31337, 52.07962], // Ridderzaal
    out: 'public/journey/den-haag',
  },
  // Journey: the Accademia di Belle Arti di Macerata (Via Vincenzo Berardi 6) and the old town.
  macerata: {
    name: 'Macerata, IT — Accademia di Belle Arti',
    origin: [13.45120, 43.30060], core: 280, fetch: 470, fade: { start: 300, end: 455 },
    focus: [13.450895, 43.301029],
    out: 'public/journey/macerata',
  },
  // Journey: the Eindhoven Tower (Bogert 31), home of Mapcreator.
  eindhoven: {
    name: 'Eindhoven, NL — Eindhoven Tower',
    origin: [5.47360, 51.44430], core: 300, fetch: 500, fade: { start: 320, end: 485 },
    focus: [5.474178, 51.444387],
    out: 'public/journey/eindhoven',
  },
};
const districtArg = process.argv.indexOf('--district');
const DISTRICT_KEY = districtArg >= 0 ? process.argv[districtArg + 1] : 'storyline';
const D = DISTRICTS[DISTRICT_KEY];
if (!D) {
  console.error(`Unknown district "${DISTRICT_KEY}". Choose one of: ${Object.keys(DISTRICTS).join(', ')}`);
  process.exit(1);
}
const OUT = path.join(ROOT, D.out);
const AREA_NAME = D.name;
const ORIGIN = D.origin; // [lon, lat]
const CORE_HALF = D.core;
const FETCH_HALF = D.fetch;
const FADE = D.fade;
const FOCUS = D.focus;
// Baked sun: light from the south-south-west, matching the MapLibre light in src/map/style.js.
const SUN = { azimuth: 210, elevation: 48 };
const BG = [0xf2, 0xf4, 0xf7];
const SHADOW = [0x3e, 0x4a, 0x60];
const LIGHTING_SIZE = 2048;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const USER_AGENT = 'Dispatch-storymap-build/0.1 (newsroom story-map portfolio demo; build-time only)';

const proj = makeProjection(ORIGIN);
const [west, south] = proj.unproject(-FETCH_HALF, -FETCH_HALF);
const [east, north] = proj.unproject(FETCH_HALF, FETCH_HALF);
const BBOX = [south, west, north, east].map((v) => v.toFixed(6)).join(',');

const QUERY = `[out:json][timeout:180];
(
  way["building"](${BBOX});
  relation["building"](${BBOX});
  way["highway"](${BBOX});
  way["area:highway"](${BBOX});
  way["railway"~"^(tram|light_rail)$"](${BBOX});
  way["natural"="water"](${BBOX});
  relation["natural"="water"](${BBOX});
  way["water"](${BBOX});
  way["waterway"~"^(riverbank|dock|canal)$"](${BBOX});
  way["landuse"~"^(basin|reservoir)$"](${BBOX});
  way["leisure"~"^(park|garden)$"](${BBOX});
  relation["leisure"~"^(park|garden)$"](${BBOX});
  way["landuse"~"^(grass|village_green|recreation_ground|flowerbed|meadow|forest)$"](${BBOX});
  relation["landuse"~"^(grass|village_green)$"](${BBOX});
  way["natural"~"^(scrub|wood|grassland)$"](${BBOX});
  node["natural"="tree"](${BBOX});
);
out geom;`;

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const fromCache = args.includes('--from-cache');
const fileArg = args.indexOf('--from-file');
const fromFile = fileArg >= 0 ? args[fileArg + 1] : null;

async function main() {
  const osm = await loadOsm();
  const out = processOsm(osm);
  await fs.mkdir(OUT, { recursive: true });
  for (const [name, fc] of Object.entries(out.layers)) {
    await fs.writeFile(path.join(OUT, `${name}.geojson`), JSON.stringify(fc));
  }
  await fs.writeFile(path.join(OUT, 'meta.json'), JSON.stringify(out.meta, null, 2));
  console.log('Baking shadows, contact shading and edge fade …');
  await fs.writeFile(path.join(OUT, 'lighting.png'), bakeLighting(out.bake));
  const sizes = await Promise.all(
    Object.keys(out.layers).map(async (n) => `${n}.geojson ${(await fs.stat(path.join(OUT, `${n}.geojson`))).size / 1024 | 0} KB`),
  );
  const png = (await fs.stat(path.join(OUT, 'lighting.png'))).size / 1024 | 0;
  console.log(`✔ Wrote ${sizes.join(', ')}, lighting.png ${png} KB`);
  console.log('  counts:', out.meta.counts, '\n  building heights:', out.meta.heightSources);
}

async function loadOsm() {
  await fs.mkdir(CACHE, { recursive: true });
  const cacheFile = path.join(CACHE, `overpass-${hashString(QUERY).toString(16)}.json`);
  if (fromFile) {
    console.log(`Reading OSM export from ${fromFile}`);
    return JSON.parse(await fs.readFile(path.resolve(fromFile), 'utf8'));
  }
  if (fromCache) {
    console.log(`Reading cached Overpass response ${path.relative(ROOT, cacheFile)}`);
    return JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  }
  const errors = [];
  let serverAnswered = false; // distinguishes "servers busy" from "network blocks Overpass"
  const ROUNDS = 5;
  for (let attempt = 0; attempt < ROUNDS; attempt++) {
    for (const endpoint of ENDPOINTS) {
      try {
        console.log(`Querying ${endpoint} (attempt ${attempt + 1}/${ROUNDS}) for bbox ${BBOX} …`);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: QUERY }),
          signal: AbortSignal.timeout(200_000),
        });
        serverAnswered = true;
        const text = await res.text();
        if (!res.ok || !text.trimStart().startsWith('{')) {
          const reason = text.match(/<strong[^>]*>Error<\/strong>:?([^<]*)/)?.[1]?.trim() ?? `${text.replace(/\s+/g, ' ').slice(0, 90)}…`;
          throw new Error(`HTTP ${res.status}: ${reason}`);
        }
        const json = JSON.parse(text);
        if (!json.elements?.length) throw new Error('empty response');
        await fs.writeFile(cacheFile, text);
        console.log(`  ✔ ${json.elements.length} elements (OSM base ${json.osm3s?.timestamp_osm_base ?? 'n/a'})`);
        return json;
      } catch (err) {
        errors.push(`${endpoint}: ${err.cause?.code ?? ''} ${err.message}`.trim());
        console.warn(`  ✖ ${err.message}`);
      }
    }
    const wait = 15_000 * (attempt + 1);
    if (attempt < ROUNDS - 1) {
      console.log(`  waiting ${wait / 1000}s before the next round …`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  const diagnosis = serverAnswered
    ? 'Overpass answered but every mirror was overloaded or returned an error. Try again in a few minutes.'
    : 'No Overpass mirror could be reached at all — the network appears to block the Overpass API.';
  console.error(`
✖ Could not get data from the Overpass API. Tried ${ENDPOINTS.length} mirrors, ${ROUNDS} rounds:
  ${errors.slice(-ENDPOINTS.length).join('\n  ')}

  ${diagnosis}
  No data was written and no substitute city was generated.
  Alternatively, export this area as Overpass/OSM JSON (e.g. overpass-turbo.eu → Export → "raw OSM data")
  and run:   npm run data -- --from-file path/to/export.json
  Bounding box (S,W,N,E): ${BBOX}
`);
  process.exit(2);
}

// ── Processing ────────────────────────────────────────────────────────────────
const R = (v) => round2(v);
const LL = (v) => Number(v.toFixed(7));
const lonlat = (p) => [LL(p.lon), LL(p.lat)];
const projectLL = (p) => proj.project(p.lon, p.lat);
const toLonLat = ([x, y]) => proj.unproject(x, y).map(LL);

function processOsm(osm) {
  const buildings = [];
  const roads = [];
  const rail = [];
  const water = [];
  const green = [];
  const trees = [];
  const bake = { buildings: [], trees: [] };
  const heightSources = { height: 0, levels: 0, estimate: 0 };
  const seen = new Set();
  const focus = proj.project(...FOCUS);
  let fid = 1;

  for (const el of osm.elements) {
    const tags = el.tags ?? {};
    const id = `${el.type[0]}${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);

    if (el.type === 'node') {
      if (tags.natural === 'tree') {
        const [x, y] = proj.project(el.lon, el.lat);
        if (districtDistance(x, y) > FADE.end + 10) continue;
        const rnd = seededRandom(hashString(id));
        const h = clamp(parseLength(tags.height) ?? 8 + rnd() * 7, 4, 28);
        const crown = clamp(parseLength(tags.diameter_crown) ?? 5 + rnd() * 3.5, 2.5, 16);
        bake.trees.push({ x, y, h, crown });
        trees.push(feature('Point', [LL(el.lon), LL(el.lat)], {
          fid: fid++, id, h: R(h), crown: R(crown),
          fade: R(fadeAt(x, y)),
        }));
      }
      continue;
    }

    const kind = classify(tags);
    if (!kind) continue;

    if (kind === 'building') {
      if (tags.location === 'underground' || Number(tags.layer) < 0 || tags.building === 'no') continue;
      for (const poly of polygonsOf(el)) {
        const c = centroid(poly[0]);
        if (districtDistance(c[0], c[1]) > FADE.end + 10) continue;
        const area = Math.abs(signedArea(poly[0])) - poly.slice(1).reduce((s, r) => s + Math.abs(signedArea(r)), 0);
        if (area < 4) continue;
        const { h, src } = buildingHeight(tags, id, area);
        heightSources[src]++;
        bake.buildings.push({ rings: poly, h });
        const props = {
          fid: fid++, id, h: R(h), hs: src, kind: tags.building, area: Math.round(area),
          fade: R(fadeAt(c[0], c[1])),
          delay: R(Math.min(1, Math.hypot(c[0] - focus[0], c[1] - focus[1]) / (FETCH_HALF * 1.1))),
        };
        if (tags.name) props.name = tags.name;
        buildings.push(feature('Polygon', closeRings(poly).map((r) => r.map(toLonLat)), props));
      }
      continue;
    }

    if (kind === 'road') {
      if (['proposed', 'abandoned', 'platform', 'bus_stop', 'elevator', 'corridor', 'razed', 'emergency_bay'].includes(tags.highway)) continue;
      if (tags.tunnel === 'yes' || tags.tunnel === 'building_passage' || tags.indoor === 'yes' || Number(tags.layer) < 0) continue;
      const isArea = tags.area === 'yes' || (el.type === 'way' && tags['area:highway']);
      const props = {
        id,
        name: tags.name ?? null,
        highway: tags.highway ?? tags['area:highway'],
        w: roadWidth(tags),
        minor: ['footway', 'path', 'cycleway', 'steps', 'bridleway', 'track'].includes(tags.highway),
      };
      if (isArea) {
        for (const poly of polygonsOf(el)) roads.push(feature('Polygon', closeRings(poly).map((r) => r.map(toLonLat)), { ...props, area: true }));
      } else if (el.geometry?.length >= 2) {
        roads.push(feature('LineString', el.geometry.map(lonlat), props));
      }
      continue;
    }

    if (kind === 'rail') {
      if (tags.tunnel === 'yes' || Number(tags.layer) < 0 || el.geometry?.length < 2) continue;
      rail.push(feature('LineString', el.geometry.map(lonlat), { id, railway: tags.railway, name: tags.name ?? null }));
      continue;
    }

    if (kind === 'water' || kind === 'green') {
      for (const poly of polygonsOf(el)) {
        const target = kind === 'water' ? water : green;
        const props = { id, name: tags.name ?? null, kind: tags.leisure ?? tags.landuse ?? tags.natural ?? tags.water ?? 'water' };
        target.push(feature('Polygon', closeRings(poly).map((r) => r.map(toLonLat)), props));
      }
    }
  }

  const corner = (x, y) => proj.unproject(x, y).map((v) => Number(v.toFixed(7)));
  const [cw, cs] = corner(-CORE_HALF, -CORE_HALF);
  const [ce, cn] = corner(CORE_HALF, CORE_HALF);
  const [fw, fs_] = corner(-FETCH_HALF, -FETCH_HALF);
  const [fe, fn] = corner(FETCH_HALF, FETCH_HALF);

  const meta = {
    name: AREA_NAME,
    origin: ORIGIN,
    focus: FOCUS,
    projection: {
      type: 'equirectangular (build-time only)',
      note: 'Files are WGS84 (lon, lat). Local metres x = (lon - lon0) * kx, y = (lat - lat0) * ky are used for build-time maths.',
      radius: 6378137,
      kx: proj.kx,
      ky: proj.ky,
    },
    core: { halfSize: CORE_HALF, bounds: [cw, cs, ce, cn] },
    fade: { ...FADE, norm: 'superellipse p=4' },
    bounds: [fw, fs_, fe, fn],
    sun: SUN,
    lighting: {
      image: 'lighting.png',
      size: LIGHTING_SIZE,
      // top-left, top-right, bottom-right, bottom-left — the order MapLibre image sources expect
      coordinates: [[fw, fn], [fe, fn], [fe, fs_], [fw, fs_]],
    },
    attribution: '© OpenStreetMap contributors',
    license: 'ODbL 1.0 — https://opendatacommons.org/licenses/odbl/',
    source: 'OpenStreetMap via the Overpass API',
    osmBase: osm.osm3s?.timestamp_osm_base ?? null,
    generatedAt: new Date().toISOString(),
    heightSources,
    counts: { buildings: buildings.length, roads: roads.length, rail: rail.length, water: water.length, green: green.length, trees: trees.length },
  };

  const fc = (features) => ({ type: 'FeatureCollection', features });
  return {
    meta,
    bake: {
      half: FETCH_HALF, size: LIGHTING_SIZE, buildings: bake.buildings, trees: bake.trees,
      sun: SUN, fade: FADE, bg: BG, shadow: SHADOW,
    },
    layers: {
      buildings: fc(buildings),
      roads: fc(roads),
      rail: fc(rail),
      water: fc(water),
      green: fc(green),
      trees: fc(trees),
    },
  };
}

function fadeAt(x, y) {
  const t = Math.min(1, Math.max(0, (districtDistance(x, y) - FADE.start) / (FADE.end - FADE.start)));
  return t * t * (3 - 2 * t);
}

function classify(tags) {
  if (tags.building && tags.building !== 'no') return 'building';
  if (tags.highway || tags['area:highway']) return 'road';
  if (tags.railway === 'tram' || tags.railway === 'light_rail') return 'rail';
  if (
    tags.natural === 'water' || tags.water ||
    ['riverbank', 'dock', 'canal'].includes(tags.waterway) ||
    ['basin', 'reservoir'].includes(tags.landuse)
  ) return 'water';
  if (
    ['park', 'garden'].includes(tags.leisure) ||
    ['grass', 'village_green', 'recreation_ground', 'flowerbed', 'meadow', 'forest'].includes(tags.landuse) ||
    ['scrub', 'wood', 'grassland'].includes(tags.natural)
  ) return 'green';
  return null;
}

/** Returns an array of polygons ([outer, ...holes]) in local metres for a closed way or multipolygon relation. */
function polygonsOf(el) {
  if (el.type === 'way') {
    const g = el.geometry;
    if (!g || g.length < 4) return [];
    const first = g[0], last = g[g.length - 1];
    if (first.lat !== last.lat || first.lon !== last.lon) return [];
    return [orient([g.slice(0, -1).map(projectLL)])];
  }
  if (el.type === 'relation') {
    const segs = { outer: [], inner: [] };
    for (const m of el.members ?? []) {
      if (m.type !== 'way' || !m.geometry?.length) continue;
      (m.role === 'inner' ? segs.inner : segs.outer).push(m.geometry.filter(Boolean));
    }
    const outers = assembleRings(segs.outer);
    const inners = assembleRings(segs.inner);
    return outers.map((outer) => orient([outer, ...inners.filter((inner) => pointInRing(inner[0], outer))]));
  }
  return [];
}

function assembleRings(segments) {
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  const pool = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    for (let guard = 0; guard < 500 && !same(ring[0], ring[ring.length - 1]); guard++) {
      const end = ring[ring.length - 1];
      const i = pool.findIndex((s) => same(s[0], end) || same(s[s.length - 1], end));
      if (i < 0) break;
      const s = pool.splice(i, 1)[0];
      ring = ring.concat((same(s[0], end) ? s : s.slice().reverse()).slice(1));
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring.slice(0, -1).map(projectLL));
  }
  return rings;
}

/** Outer ring counter-clockwise, holes clockwise (RFC 7946 winding, with y = north). */
function orient([outer, ...holes]) {
  const o = signedArea(outer) < 0 ? outer.slice().reverse() : outer;
  return [o, ...holes.map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h))];
}

const closeRings = (poly) => poly.map((ring) => [...ring, ring[0]]);
const feature = (type, coordinates, properties) => ({ type: 'Feature', properties, geometry: { type, coordinates } });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function parseLength(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  let m = s.match(/^([\d.]+)\s*(m|meter|meters|metre|metres)?$/i);
  if (m) return parseFloat(m[1]);
  m = s.match(/^([\d.]+)\s*(ft|')$/i);
  if (m) return parseFloat(m[1]) * 0.3048;
  return null;
}

const STOREY = 3.2;
function buildingHeight(tags, id, area) {
  const h = parseLength(tags.height) ?? parseLength(tags['building:height']);
  if (h && h > 2 && h < 250) return { h, src: 'height' };
  const levels = parseFloat(tags['building:levels']);
  const roofLevels = parseFloat(tags['roof:levels']) || 0;
  if (levels > 0 && levels < 60) return { h: levels * STOREY + roofLevels * 2.2 + 1.2, src: 'levels' };

  // No tags: a small seeded estimate keeps every rebuild identical.
  const rnd = seededRandom(hashString(id));
  const k = tags.building;
  let lo = 3, hi = 5; // storeys
  if (['house', 'terrace', 'detached', 'semidetached_house', 'residential'].includes(k)) { lo = 3; hi = 4; }
  if (['church', 'cathedral', 'chapel', 'basilica'].includes(k)) { lo = 5; hi = 7; }
  if (['garage', 'garages', 'shed', 'kiosk', 'hut', 'roof', 'carport', 'service', 'toilets', 'bicycle_parking', 'container'].includes(k)) { lo = 1; hi = 1; }
  if (area > 1200) { lo += 1; hi += 2; }
  if (area < 35) { lo = 1; hi = Math.min(hi, 2); }
  const storeys = lo + Math.floor(rnd() * (hi - lo + 1));
  return { h: storeys * STOREY + 1.0 + rnd() * 0.8, src: 'estimate' };
}

const ROAD_WIDTHS = {
  motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 8.5, unclassified: 7,
  residential: 6.5, living_street: 5.5, pedestrian: 6.5, service: 4, busway: 6.5, road: 6,
  cycleway: 2.6, footway: 2.2, path: 2, steps: 2.2, track: 3, bridleway: 2.2,
};
function roadWidth(tags) {
  const w = parseLength(tags.width);
  if (w && w > 1.5 && w < 30) return R(w);
  return ROAD_WIDTHS[tags.highway] ?? 4;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
