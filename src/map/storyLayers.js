// Time-driven story layers on top of the clay city. Everything is applied from the state
// returned by computeState(model, t): affected buildings, movement trails and dots,
// crowd columns with their uncertainty shell, closures, barriers and rerouted buses.

import { COLORS, CONFIDENCE, CROWD } from '../config.js';
import { metres } from './style.js';
import { measurePath, pointAlong, pointInRing, distToRing, ringCentroid, clamp01, smoothstep, circleRing } from '../util/geo.js';

const BEFORE = 'trees'; // ground overlays sit under every extrusion
const EMPTY = { type: 'FeatureCollection', features: [] };

export function createStoryLayers({ api, model, local, buildings, reducedMotion, lat }) {
  const { map } = api;
  const m = metres(lat);
  const moving = model.events.filter((e) => e.type === 'movement' && e.geom.lines);
  const closures = model.events.filter((e) => e.type === 'closure' && e.geom.lines);
  const reroutes = model.events.filter((e) => e.type === 'transport' && e.geom.lines);
  const gatherings = model.events.filter((e) => e.crowd && e.type !== 'movement');

  // ── Affected buildings ──────────────────────────────────────────────────────
  // building id → [{ event, role }]; role 0 = blue involvement, 1 = coral incident/closed, 2 = amber
  const affected = new Map();
  for (const e of model.events) {
    for (const id of e.buildingIds) {
      const role = e.type === 'incident' || e.type === 'closure' ? 1 : e.confidence === 'unverified' ? 2 : 0;
      if (!affected.has(id)) affected.set(id, []);
      affected.get(id).push({ e, role });
    }
  }
  const strength = { confirmed: 1, reported: 0.72, disputed: 0.6, unverified: 0.5 };

  // ── Movement: trail lines (one source per event so each has its own head) ──
  const movers = moving.map((e) => {
    const paths = e.geom.lines.map((line) => measurePath(line.map(local.toXY)));
    const color = CONFIDENCE[e.confidence].color;
    const dots = Math.round(Math.min(18, Math.max(7, (e.crowd?.estimate ?? 600) / 85)));
    return { e, paths, color, dots, src: `move-${e.id}` };
  });

  // ── Crowds: hex cells inside each gathering area, ranked from its focus outwards ──
  const crowds = gatherings.map((e) => {
    const { cells, focus } = hexCells(e);
    return { e, cells, focus, src: `crowd-${e.id}` };
  });

  // ── Closures & reroutes ─────────────────────────────────────────────────────
  const closureFeatures = closures.flatMap((e, i) => e.geom.lines.map((line, j) => ({
    type: 'Feature', id: i * 100 + j + 1,
    properties: { ev: e.id, w: e.geom.width ?? 12 },
    geometry: { type: 'LineString', coordinates: line },
  })));
  const barrierFeatures = closures.flatMap((e, i) => e.geom.lines.flatMap((line, j) => {
    const path = measurePath(line.map(local.toXY));
    const w = (e.geom.width ?? 12) * 0.9;
    return [2, path.length - 2].map((d, k) => {
      const { p, t, n } = pointAlong(path, d);
      const hw = w / 2, hd = 0.45;
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => local.toLL([
        p[0] + n[0] * a + t[0] * b, p[1] + n[1] * a + t[1] * b,
      ]));
      return {
        type: 'Feature', id: i * 100 + j * 2 + k + 1,
        properties: { ev: e.id },
        geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] },
      };
    });
  }));
  const rerouteFeatures = reroutes.flatMap((e, i) => e.geom.lines.map((line, j) => ({
    type: 'Feature', id: i * 100 + j + 1,
    properties: { ev: e.id },
    geometry: { type: 'LineString', coordinates: line },
  })));

  // ── Add sources & layers ────────────────────────────────────────────────────
  function install() {
    map.addSource('closures', { type: 'geojson', data: fc(closureFeatures) });
    map.addSource('barriers', { type: 'geojson', data: EMPTY });
    map.addSource('reroutes', { type: 'geojson', data: fc(rerouteFeatures) });
    map.addSource('movers', { type: 'geojson', data: EMPTY });
    map.addSource('crowd-heat', { type: 'geojson', data: fc(crowds.map(({ e, focus }, i) => ({
      type: 'Feature', id: i + 1, properties: { ev: e.id },
      geometry: { type: 'Point', coordinates: focus },
    }))) });
    if (reducedMotion && !map.hasImage('chevron')) map.addImage('chevron', chevronImage());

    const on = ['coalesce', ['feature-state', 'on'], 0];

    // Closed roads: a translucent coral band, a solid core and white "tape" dashes.
    map.addLayer({
      id: 'closure-band', type: 'line', source: 'closures', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': COLORS.coral, 'line-opacity': ['*', 0.28, on], 'line-width': m(['+', ['get', 'w'], 4]) },
    }, BEFORE);
    map.addLayer({
      id: 'closure-core', type: 'line', source: 'closures', layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': COLORS.coral, 'line-opacity': ['*', 0.9, on], 'line-width': m(['*', ['get', 'w'], 0.42]) },
    }, BEFORE);
    map.addLayer({
      id: 'closure-tape', type: 'line', source: 'closures', layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': ['*', 0.85, on], 'line-width': m(['*', ['get', 'w'], 0.12]), 'line-dasharray': [1.4, 1.4] },
    }, BEFORE);

    // Rerouted buses: white casing with coral dashes that travel along the route.
    map.addLayer({
      id: 'reroute-casing', type: 'line', source: 'reroutes', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': ['*', 0.9, on], 'line-width': m(4.2) },
    }, BEFORE);
    map.addLayer({
      id: 'reroute-dash', type: 'line', source: 'reroutes', layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': COLORS.coral, 'line-opacity': on, 'line-width': m(2.2), 'line-dasharray': DASH_STEPS[0] },
    }, BEFORE);

    // Movement trails: a soft glow and a crisp core, both drawn with a line gradient
    // whose bright head and fading tail are moved as story time advances.
    for (const mv of movers) {
      map.addSource(mv.src, {
        type: 'geojson', lineMetrics: true,
        data: fc(mv.e.geom.lines.map((line, i) => ({ type: 'Feature', id: i + 1, properties: {}, geometry: { type: 'LineString', coordinates: line } }))),
      });
      map.addLayer({
        id: `${mv.src}-glow`, type: 'line', source: mv.src, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': m(13), 'line-blur': m(7), 'line-gradient': gradient(mv.color, 0, 0, 0.5) },
      }, BEFORE);
      map.addLayer({
        id: `${mv.src}-core`, type: 'line', source: mv.src, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': m(3.2), 'line-gradient': gradient(mv.color, 0, 0, 1) },
      }, BEFORE);
      if (reducedMotion) {
        map.addLayer({
          id: `${mv.src}-arrows`, type: 'symbol', source: mv.src,
          layout: { 'symbol-placement': 'line', 'symbol-spacing': 70, 'icon-image': 'chevron', 'icon-size': 0.5, 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map' },
          paint: { 'icon-opacity': 0 },
        }, BEFORE);
      }
    }
    // Dots: the body of the march.
    map.addLayer({
      id: 'movers-glow', type: 'circle', source: 'movers',
      paint: {
        'circle-color': ['get', 'color'], 'circle-opacity': ['*', 0.22, ['get', 'a']],
        'circle-radius': m(['*', 3.6, ['get', 'r']]), 'circle-blur': 0.9,
        'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map',
      },
    }, BEFORE);
    map.addLayer({
      id: 'movers', type: 'circle', source: 'movers',
      paint: {
        'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'a'],
        'circle-radius': m(['*', 1.25, ['get', 'r']]),
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': m(['*', 0.45, ['get', 'r']]), 'circle-stroke-opacity': ['get', 'a'],
        'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map',
      },
    }, BEFORE);

    // Crowd heat footprint on the ground.
    map.addLayer({
      id: 'crowd-heat', type: 'circle', source: 'crowd-heat',
      paint: {
        'circle-color': ['coalesce', ['feature-state', 'color'], COLORS.blue],
        'circle-opacity': ['*', 0.2, ['coalesce', ['feature-state', 'a'], 0]],
        'circle-radius': m(['coalesce', ['feature-state', 'r'], 0]),
        'circle-blur': 0.75,
        'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map',
      },
    }, BEFORE);

    // 3D layers (after the buildings so depth sorting is shared).
    map.addLayer({
      id: 'barriers', type: 'fill-extrusion', source: 'barriers',
      paint: {
        'fill-extrusion-color': COLORS.coral,
        'fill-extrusion-height': ['*', 1.15, on],
        'fill-extrusion-base': ['*', 0.25, on],
        'fill-extrusion-vertical-gradient': false,
      },
    }, 'dispatch-projector');

    // Zero-height extrusions still draw a flat roof, so each crowd source only ever
    // holds the cells that are currently occupied (see update()).
    for (const c of crowds) {
      map.addSource(`${c.src}-core`, { type: 'geojson', data: EMPTY, promoteId: 'fid' });
      map.addSource(`${c.src}-shell`, { type: 'geojson', data: EMPTY, promoteId: 'fid' });
      const color = CONFIDENCE[c.e.confidence].color;
      const h = ['coalesce', ['feature-state', 'h'], 0.01];
      map.addLayer({
        id: `${c.src}-core`, type: 'fill-extrusion', source: `${c.src}-core`,
        paint: {
          'fill-extrusion-color': color,
          'fill-extrusion-height': ['coalesce', ['feature-state', 'core'], 0.01],
          'fill-extrusion-base': 0,
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-opacity': 0.92,
        },
      }, 'dispatch-projector');
      map.addLayer({
        id: `${c.src}-shell`, type: 'fill-extrusion', source: `${c.src}-shell`,
        paint: {
          'fill-extrusion-color': COLORS.blueSoft,
          'fill-extrusion-height': h,
          'fill-extrusion-base': 0,
          'fill-extrusion-vertical-gradient': false,
          'fill-extrusion-opacity': 0.3,
        },
      }, 'dispatch-projector');
      if (c.e.confidence === 'disputed') map.setPaintProperty(`${c.src}-shell`, 'fill-extrusion-color', COLORS.amberTint);
      if (c.e.confidence === 'unverified') map.setPaintProperty(`${c.src}-shell`, 'fill-extrusion-color', COLORS.amberTint);
    }
  }

  // ── Apply state ─────────────────────────────────────────────────────────────
  const prev = { buildings: new Map(), closures: new Map(), barriers: new Map(), reroutes: new Map(), crowd: new Map(), heat: new Map(), grad: new Map() };
  let layersOn = { movement: true, crowd: true, closures: true, buildings: true };
  let hoverId = null;

  function setFS(source, id, state, cacheKey, cache) {
    const key = JSON.stringify(state);
    if (cache.get(cacheKey) === key) return;
    cache.set(cacheKey, key);
    map.setFeatureState({ source, id }, state);
  }

  function update(st) {
    // Buildings: tint follows the linked events in time.
    for (const [bid, links] of affected) {
      let tint = 0, role = 0;
      for (const { e, role: r } of links) {
        const s = st.ev.get(e.id);
        const v = s.appear * s.fadeOut * strength[e.confidence];
        if (v > tint) { tint = v; role = r; }
      }
      if (!layersOn.buildings) tint = 0;
      const visible = links.some(({ e }) => st.ev.get(e.id).vis);
      const hover = hoverId === bid && visible ? 1 : 0;
      for (const fid of buildings.get(bid).fids) {
        setFS('buildings', fid, { tint: round(tint, 100), role, hover }, `b${fid}`, prev.buildings);
      }
    }

    // Closures and barriers.
    closureFeatures.forEach((f) => {
      const s = st.ev.get(f.properties.ev);
      const on = layersOn.closures ? s.appear * s.fadeOut : 0;
      setFS('closures', f.id, { on: round(on, 50) }, f.id, prev.closures);
    });
    const liveBarriers = barrierFeatures.filter((f) => {
      const s = st.ev.get(f.properties.ev);
      return layersOn.closures && s.appear * s.fadeOut > 0.03;
    });
    const barrierKey = liveBarriers.map((f) => f.id).join(',');
    if (prev.barrierKey !== barrierKey) {
      prev.barrierKey = barrierKey;
      prev.barriers.clear();
      map.getSource('barriers')?.setData(fc(liveBarriers));
    }
    liveBarriers.forEach((f) => {
      const s = st.ev.get(f.properties.ev);
      setFS('barriers', f.id, { on: round(smoothstep(0, 1, s.appear * s.fadeOut), 20) }, f.id, prev.barriers);
    });
    rerouteFeatures.forEach((f) => {
      const s = st.ev.get(f.properties.ev);
      const on = layersOn.closures ? s.appear * s.fadeOut : 0;
      setFS('reroutes', f.id, { on: round(on, 50) }, f.id, prev.reroutes);
    });
    rerouteActive = layersOn.closures && rerouteFeatures.some((f) => st.ev.get(f.properties.ev).vis && st.ev.get(f.properties.ev).fadeOut > 0);

    // Movement trails and dots.
    const dots = [];
    for (const mv of movers) {
      const s = st.ev.get(mv.e.id);
      const show = layersOn.movement && s.vis;
      const p = s.progress;
      const done = s.vis ? smoothstep(mv.e.end, mv.e.end + 8, st.t) : 0; // after arrival the trail settles
      const trailFrac = mv.paths.map((path) => Math.min(0.9, 170 / Math.max(1, path.length)));
      const key = `${show}|${p.toFixed(4)}|${done.toFixed(2)}`;
      if (prev.grad.get(mv.src) !== key) {
        prev.grad.set(mv.src, key);
        const tf = trailFrac[0];
        const headAlpha = reducedMotion ? 0.85 : 1 - done * 0.75;
        map.setPaintProperty(`${mv.src}-glow`, 'line-gradient', show ? gradient(mv.color, p, reducedMotion ? 0 : tf, 0.55 * headAlpha, 0.12) : HIDDEN);
        map.setPaintProperty(`${mv.src}-core`, 'line-gradient', show ? gradient(mv.color, p, reducedMotion ? 0 : tf, headAlpha, reducedMotion ? 0.75 : 0.3) : HIDDEN);
        if (reducedMotion) map.setPaintProperty(`${mv.src}-arrows`, 'icon-opacity', show ? 0.9 : 0);
      }
      if (!show || reducedMotion) continue;
      const a = 1 - done;
      if (a <= 0.01) continue;
      // Spread the dots over all branches of the movement (one branch for a march, several for a dispersal).
      const per = Math.max(3, Math.round(mv.dots / mv.paths.length));
      mv.paths.forEach((path, pi) => {
        const head = path.length * p;
        for (let i = 0; i < per; i++) {
          const d = head - i * 8.5;
          if (d < 0) break;
          const { p: xy, n } = pointAlong(path, d);
          const jitter = Math.sin((i + 1) * 12.9898 + pi * 4.1) * 2.1;
          dots.push({
            type: 'Feature',
            properties: { color: mv.color, a: a * (i === 0 ? 1 : 0.9 - (i / per) * 0.45), r: i === 0 ? 1.45 : 1 },
            geometry: { type: 'Point', coordinates: local.toLL([xy[0] + n[0] * jitter, xy[1] + n[1] * jitter]) },
          });
        }
      });
    }
    const dotsKey = dots.length + ':' + dots.map((d) => d.geometry.coordinates[0].toFixed(7)).join('');
    if (prev.dots !== dotsKey) {
      prev.dots = dotsKey;
      map.getSource('movers')?.setData(fc(dots));
    }

    // Crowds: solid core = low estimate, glass shell = high estimate.
    crowds.forEach((c, i) => {
      const s = st.ev.get(c.e.id);
      const cr = layersOn.crowd && s.crowd ? s.crowd : { estimate: 0, low: 0, high: 0 };
      const per = CROWD.peoplePerColumn;
      const nLow = Math.ceil(cr.low / per), nHigh = Math.ceil(cr.high / per);
      const hLow = cr.low > 0 ? colLow(cr.low) : 0;
      const hHigh = cr.high > 0 ? colHigh(cr.high) : 0;
      const nCore = Math.min(nLow, c.cells.length), nShell = Math.min(nHigh, c.cells.length);
      if (c.nCore !== nCore) {
        c.nCore = nCore;
        map.getSource(`${c.src}-core`)?.setData(fc(c.cells.slice(0, nCore).map((cell) => cell.feature)));
      }
      if (c.nShell !== nShell) {
        c.nShell = nShell;
        map.getSource(`${c.src}-shell`)?.setData(fc(c.cells.slice(0, nShell).map((cell) => cell.feature)));
      }
      for (let rank = 0; rank < nShell; rank++) {
        const cell = c.cells[rank];
        const h = round(hHigh * (1 - 0.35 * (rank / Math.max(1, nShell))), 4);
        setFS(`${c.src}-shell`, cell.fid, { h }, `s${c.src}${cell.fid}`, prev.crowd);
        if (rank < nCore) {
          const core = round(hLow * (1 - 0.35 * (rank / Math.max(1, nCore))), 4);
          setFS(`${c.src}-core`, cell.fid, { core }, `c${c.src}${cell.fid}`, prev.crowd);
        }
      }
      const r = cr.high > 0 ? Math.sqrt((nHigh * CROWD.hexRadius ** 2 * 2.6) / Math.PI) + 10 : 0;
      setFS('crowd-heat', i + 1, { r: round(r, 2), a: cr.high > 0 ? 1 : 0, color: CONFIDENCE[c.e.confidence].color }, i, prev.heat);
    });
  }

  // Dash animation for rerouted buses (wall clock, low frame rate, paused for reduced motion).
  let rerouteActive = false;
  let dashIndex = 0;
  if (!reducedMotion) {
    setInterval(() => {
      if (!rerouteActive || document.hidden || !map.getLayer('reroute-dash')) return;
      dashIndex = (dashIndex + 1) % DASH_STEPS.length;
      map.setPaintProperty('reroute-dash', 'line-dasharray', DASH_STEPS[dashIndex]);
    }, 90);
  }

  function setLayers(layers) {
    layersOn = { ...layersOn, ...layers };
    for (const mv of movers) {
      for (const suffix of ['glow', 'core', ...(reducedMotion ? ['arrows'] : [])]) {
        map.setLayoutProperty(`${mv.src}-${suffix}`, 'visibility', layersOn.movement ? 'visible' : 'none');
      }
    }
    for (const id of ['movers', 'movers-glow']) map.setLayoutProperty(id, 'visibility', layersOn.movement ? 'visible' : 'none');
    for (const c of crowds) {
      for (const s of ['core', 'shell']) map.setLayoutProperty(`${c.src}-${s}`, 'visibility', layersOn.crowd ? 'visible' : 'none');
    }
    map.setLayoutProperty('crowd-heat', 'visibility', layersOn.crowd ? 'visible' : 'none');
    for (const id of ['closure-band', 'closure-core', 'closure-tape', 'reroute-casing', 'reroute-dash', 'barriers']) {
      map.setLayoutProperty(id, 'visibility', layersOn.closures ? 'visible' : 'none');
    }
  }

  function setHover(buildingId) {
    hoverId = buildingId;
  }

  /** Where to put the crowd label: above the tallest shell column. */
  function crowdLabels(st) {
    return crowds.map((c) => {
      const s = st.ev.get(c.e.id);
      const cr = s.crowd ?? { estimate: 0, low: 0, high: 0 };
      const hHigh = cr.high > 0 ? colHigh(cr.high) : 0;
      return { e: c.e, crowd: cr, lngLat: c.focus, altitude: hHigh + 3 };
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  function hexCells(e) {
    const r = CROWD.hexRadius;
    const dx = Math.sqrt(3) * r, dy = 1.5 * r;
    let ring, focus;
    if (e.geom.ring) {
      ring = e.geom.ring.map(local.toXY);
      focus = ringCentroid(ring);
    } else {
      focus = local.toXY(e.geom.point ?? e.geom.anchor);
      const R = 70;
      ring = Array.from({ length: 24 }, (_, i) => [focus[0] + Math.cos((i / 24) * Math.PI * 2) * R, focus[1] + Math.sin((i / 24) * Math.PI * 2) * R]);
    }
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const cells = [];
    let row = 0;
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += dy, row++) {
      for (let x = Math.min(...xs) + (row % 2) * (dx / 2); x <= Math.max(...xs); x += dx) {
        if (!pointInRing([x, y], ring) || distToRing([x, y], ring) < r * 0.9) continue;
        cells.push({ x, y, d: Math.hypot(x - focus[0], y - focus[1]) });
      }
    }
    cells.sort((a, b) => a.d - b.d);
    return {
      focus: local.toLL(focus),
      cells: cells.map((cell, i) => ({
        fid: i + 1,
        feature: {
          type: 'Feature',
          properties: { fid: i + 1 },
          geometry: { type: 'Polygon', coordinates: [circleRing(local, [cell.x, cell.y], r * 0.86, 6, Math.PI / 6)] },
        },
      })),
    };
  }

  return {
    install,
    update,
    setLayers,
    setHover,
    crowdLabels,
    affectedBuildings: () => [...affected.keys()],
  };
}

const fc = (features) => ({ type: 'FeatureCollection', features });
// Column heights in metres: the solid core follows the low estimate, the glass shell the high one.
const colLow = (n) => 3 + 11 * Math.sqrt(n / 3000);
const colHigh = (n) => 4 + 13 * Math.sqrt(n / 3000);
const round = (v, k) => Math.round(v * k) / k;

const HIDDEN = ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'];

/**
 * Line gradient for a trail: faint traversed route, a bright fading tail behind the head,
 * and nothing ahead of the head.
 */
function gradient(hex, p, tail, headAlpha = 1, baseAlpha = 0.22) {
  const [r, g, b] = hexToRgb(hex);
  const c = (a) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  if (p <= 0.0005) return HIDDEN;
  const head = Math.min(p, 0.9995);
  const stops = [0, c(baseAlpha)];
  const tailStart = Math.max(0.0001, head - tail);
  if (tail > 0 && tailStart < head - 0.0002) stops.push(tailStart, c(baseAlpha));
  stops.push(head, c(headAlpha));
  stops.push(Math.min(0.99995, head + 0.0003), c(0));
  stops.push(1, c(0));
  // de-duplicate / keep strictly ascending stops
  const clean = [];
  for (let i = 0; i < stops.length; i += 2) {
    if (clean.length && stops[i] <= clean[clean.length - 2]) continue;
    clean.push(stops[i], stops[i + 1]);
  }
  return ['interpolate', ['linear'], ['line-progress'], ...clean];
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// A dash pattern shifted in 12 steps; cycling through them makes the dashes travel.
const DASH_STEPS = (() => {
  const dash = 2.2, gap = 1.8, n = 12, period = dash + gap;
  const steps = [];
  for (let i = 0; i < n; i++) {
    const o = (i / n) * period;
    if (o <= gap) steps.push([0, o, dash, gap - o]);
    else steps.push([o - gap, gap, dash - (o - gap), 0]);
  }
  return steps.map((s) => s.map((v) => Math.max(0, +v.toFixed(3))));
})();

/** A small white chevron used as a static direction marker when motion is reduced. */
function chevronImage() {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(16, 10);
  ctx.lineTo(32, 24);
  ctx.lineTo(16, 38);
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}
