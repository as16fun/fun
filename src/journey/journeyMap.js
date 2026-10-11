// The journey map: a light Europe base (Natural Earth) with three clay city districts
// (OpenStreetMap) that fade in as the camera descends and grow in a wave on arrival.
// Flights between cities use a van Wijk–Nuij zoom/pan path (the same maths as MapLibre's
// flyTo) with a pitch dip, so Europe reads top-down mid-flight and the city in 3D on arrival.

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { COLORS } from '../config.js';
import { metres, treeSolids } from '../map/style.js';
import { makeLocal, circleRing, clamp, lerp } from '../util/geo.js';
import { easeInOutCubic, easeOutCubic } from '../util/store.js';

maplibregl.setWorkerUrl(workerUrl);

/** The journey map reads as a light, grey-green clay model; the prototype keeps the shared cool-grey COLORS. */
const GROUND = '#EEF1EA';
const J = {
  ...COLORS,
  bg: GROUND, ground: GROUND, clayFar: GROUND,
  clay: '#E4E9DD',
  road: '#F8FAF3', roadMinor: '#F8FAF3', square: '#F5F8EF', rail: '#D2D8C8',
  water: '#D3E0DC', waterEdge: '#BFD0CA',
  green: '#E0EAD3', tree: '#CFDDBE', trunk: '#C9CDBF',
};

export const PALETTE = {
  sea: '#DCE5DF',
  land: J.bg, // equals the baked lighting's fade colour, so districts melt into the land
  urban: '#E6EBE0',
  border: '#C5CEBF',
  river: '#CBDAD3',
  route: '#84E024',
  highlight: '#C8F577',
  highlightTint: '#E3F9B0',
};

const CITY_FADE = [12.7, 13.7]; // zoom range in which a district appears
const ROUTE_FADE = [9.5, 11.5]; // zoom range in which the Europe route disappears

export function createJourneyMap({ container, europe, start, reducedMotion }) {
  const map = new maplibregl.Map({
    container,
    style: baseStyle(europe),
    center: start.center,
    zoom: start.zoom,
    pitch: start.pitch ?? 0,
    bearing: start.bearing ?? 0,
    minZoom: 3.2,
    maxZoom: 19,
    maxPitch: 65,
    renderWorldCopies: false,
    attributionControl: false,
    keyboard: false,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    fadeDuration: 0,
    validateStyle: false,
    canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' },
  });
  map.setVerticalFieldOfView(18);

  // Rooftop projection for DOM markers (see src/map/createMap.js for the reasoning).
  const projector = {
    id: 'journey-projector', type: 'custom', renderingMode: '3d', matrix: null,
    onAdd() {},
    render(_gl, args) { this.matrix = args.defaultProjectionData?.mainMatrix ?? null; },
  };
  const ready = new Promise((resolve) => {
    map.once('style.load', () => { map.addLayer(projector); resolve(); });
  });

  function screenAt(lngLat, altitude = 0) {
    const ground = map.project(lngLat);
    const m = projector.matrix;
    if (!altitude || !m) return ground;
    const mc = maplibregl.MercatorCoordinate.fromLngLat(lngLat, 0);
    const mz = maplibregl.MercatorCoordinate.fromLngLat(lngLat, altitude).z;
    const clip = (z) => [
      m[0] * mc.x + m[4] * mc.y + m[8] * z + m[12],
      m[1] * mc.x + m[5] * mc.y + m[9] * z + m[13],
      m[3] * mc.x + m[7] * mc.y + m[11] * z + m[15],
    ];
    const a = clip(0), b = clip(mz);
    if (a[2] <= 0 || b[2] <= 0) return ground;
    const { clientWidth: W, clientHeight: H } = map.getContainer();
    return new maplibregl.Point(ground.x + ((b[0] / b[2] - a[0] / a[2]) / 2) * W, ground.y - ((b[1] / b[2] - a[1] / a[2]) / 2) * H);
  }

  // ── Interaction: off while the story drives the camera ──────────────────────
  const handlers = ['scrollZoom', 'boxZoom', 'dragRotate', 'dragPan', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch'];
  function setInteractive(on) {
    for (const name of handlers) map[name][on ? 'enable' : 'disable']();
    container.classList.toggle('is-interactive', on);
  }
  setInteractive(false);

  // ── Cities ──────────────────────────────────────────────────────────────────
  const cities = new Map(); // key → { local, origin, buildingFids, treeFids, highlight, grown }

  function addCity(key, d, { highlightIds = [] } = {}) {
    if (cities.has(key)) return;
    const lat = d.meta.origin[1];
    const m = metres(lat);
    const local = makeLocal(d.meta.origin);
    const fadeIn = (to = 1) => ['interpolate', ['linear'], ['zoom'], CITY_FADE[0], 0, CITY_FADE[1], to];
    const isHighlight = ['in', ['get', 'id'], ['literal', highlightIds]];
    const grow = ['coalesce', ['feature-state', 'grow'], 1];
    const edgeShrink = ['-', 1, ['*', 0.92, ['get', 'fade']]];
    const trees = treeSolids(d.trees, local, circleRing, local.toXY(d.meta.focus));

    map.addSource(`${key}-green`, { type: 'geojson', data: d.green });
    map.addSource(`${key}-water`, { type: 'geojson', data: d.water });
    map.addSource(`${key}-roads`, { type: 'geojson', data: d.roads });
    map.addSource(`${key}-rail`, { type: 'geojson', data: d.rail });
    map.addSource(`${key}-lighting`, { type: 'image', url: `${d.base}/${d.meta.lighting.image}`, coordinates: d.meta.lighting.coordinates });
    map.addSource(`${key}-buildings`, { type: 'geojson', data: d.buildings, promoteId: 'fid' });
    map.addSource(`${key}-trees`, { type: 'geojson', data: trees, promoteId: 'fid' });

    const before = 'route-ghost';
    map.addLayer({ id: `${key}-green`, type: 'fill', source: `${key}-green`, paint: { 'fill-color': J.green, 'fill-opacity': fadeIn() } }, before);
    map.addLayer({ id: `${key}-squares`, type: 'fill', source: `${key}-roads`, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': J.square, 'fill-opacity': fadeIn() } }, before);
    map.addLayer({ id: `${key}-water`, type: 'fill', source: `${key}-water`, paint: { 'fill-color': J.water, 'fill-opacity': fadeIn() } }, before);
    map.addLayer({
      id: `${key}-roads-minor`, type: 'line', source: `${key}-roads`,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'minor'], true]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': J.roadMinor, 'line-width': m(['get', 'w']), 'line-opacity': fadeIn() },
    }, before);
    map.addLayer({
      id: `${key}-roads`, type: 'line', source: `${key}-roads`,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'minor'], true]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': J.road, 'line-width': m(['get', 'w']), 'line-opacity': fadeIn() },
    }, before);
    map.addLayer({ id: `${key}-rail`, type: 'line', source: `${key}-rail`, paint: { 'line-color': J.rail, 'line-width': m(0.24), 'line-gap-width': m(1.435), 'line-opacity': fadeIn() } }, before);
    map.addLayer({ id: `${key}-lighting`, type: 'raster', source: `${key}-lighting`, paint: { 'raster-opacity': fadeIn(), 'raster-fade-duration': 0 } }, before);

    // 3D: trees, buildings, the highlighted building — all above the route and dots.
    map.addLayer({
      id: `${key}-trees`, type: 'fill-extrusion', source: `${key}-trees`,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'fade'], 0, ['match', ['get', 'part'], 'trunk', J.trunk, J.tree], 1, J.clayFar],
        'fill-extrusion-base': ['*', ['get', 'base'], edgeShrink, grow],
        'fill-extrusion-height': ['*', ['get', 'top'], edgeShrink, grow],
        'fill-extrusion-vertical-gradient': true,
        'fill-extrusion-opacity': fadeIn(),
      },
    }, 'journey-projector');
    map.addLayer({
      id: `${key}-buildings`, type: 'fill-extrusion', source: `${key}-buildings`,
      filter: ['!', isHighlight],
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'fade'], 0, J.clay, 1, J.clayFar],
        'fill-extrusion-height': ['*', ['get', 'h'], edgeShrink, grow],
        'fill-extrusion-vertical-gradient': true,
        'fill-extrusion-opacity': fadeIn(),
      },
    }, 'journey-projector');
    map.addLayer({
      id: `${key}-highlight`, type: 'fill-extrusion', source: `${key}-buildings`,
      filter: isHighlight,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['feature-state', 'tint'], 0], 0, J.clay, 1, PALETTE.highlightTint, 1.3, PALETTE.highlight],
        'fill-extrusion-height': ['*', ['get', 'h'], ['+', 1, ['*', 0.06, ['coalesce', ['feature-state', 'tint'], 0]]], grow],
        'fill-extrusion-vertical-gradient': true,
        'fill-extrusion-opacity': fadeIn(),
      },
    }, 'journey-projector');

    const highlight = d.buildings.features.filter((f) => highlightIds.includes(f.properties.id));
    const city = {
      key, local, origin: d.meta.origin,
      buildingFids: d.buildings.features.map((f) => [f.properties.fid, f.properties.delay]),
      treeFids: trees.features.map((f) => [f.properties.fid, f.properties.delay]),
      highlight: highlight.map((f) => ({ fid: f.properties.fid, h: f.properties.h, ring: f.geometry.coordinates[0].slice(0, -1) })),
      grown: reducedMotion,
      growing: false,
      tint: 0,
    };
    cities.set(key, city);
    if (!reducedMotion) setGrow(city, 0);
  }

  function setGrow(city, v) {
    for (const [fid] of city.buildingFids) map.setFeatureState({ source: `${city.key}-buildings`, id: fid }, { grow: v });
    for (const [fid] of city.treeFids) map.setFeatureState({ source: `${city.key}-trees`, id: fid }, { grow: v });
  }

  /** The city builds itself: a wave of buildings and trees rising from the focus point. */
  function growCity(city) {
    if (city.grown || city.growing) return;
    city.growing = true;
    const t0 = performance.now();
    const total = 1700;
    const levels = 12;
    const last = new Map();
    const step = () => {
      const T = clamp((performance.now() - t0) / total, 0, 1);
      const wave = (list, source) => {
        for (const [fid, delay] of list) {
          const q = Math.round(easeOutCubic(clamp((T * 1.6 - delay * 1.1) / 0.5, 0, 1)) * levels) / levels;
          if (last.get(source + fid) !== q) {
            last.set(source + fid, q);
            map.setFeatureState({ source, id: fid }, { grow: q });
          }
        }
      };
      wave(city.buildingFids, `${city.key}-buildings`);
      wave(city.treeFids, `${city.key}-trees`);
      if (T < 1 && city.growing) requestAnimationFrame(step);
      else {
        city.growing = false;
        city.grown = true;
        setGrow(city, 1);
      }
    };
    requestAnimationFrame(step);
  }

  function setTint(city, target) {
    const from = city.tint;
    if (Math.abs(from - target) < 0.01 || !city.highlight.length) return;
    const t0 = performance.now();
    const dur = reducedMotion ? 0 : 700;
    const step = () => {
      const k = dur ? clamp((performance.now() - t0) / dur, 0, 1) : 1;
      city.tint = lerp(from, target, easeInOutCubic(k));
      for (const b of city.highlight) map.setFeatureState({ source: `${city.key}-buildings`, id: b.fid }, { tint: city.tint });
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  // Cities regrow every time the camera comes back down into them.
  map.on('move', () => {
    const z = map.getZoom();
    const c = map.getCenter();
    for (const city of cities.values()) {
      const [x, y] = city.local.toXY([c.lng, c.lat]);
      const near = Math.hypot(x, y) < 2500;
      if (near && z >= CITY_FADE[0] + 0.2) growCity(city);
      else if (!reducedMotion && city.grown && (z < CITY_FADE[0] - 0.4 || !near)) {
        city.grown = false;
        setGrow(city, 0);
      }
    }
  });

  // ── Route between the cities ────────────────────────────────────────────────
  let routeSegments = [];
  function setRoute(points) {
    routeSegments = [];
    for (let i = 0; i < points.length - 1; i++) {
      const coords = arc(points[i], points[i + 1]);
      routeSegments.push({ id: `route-${i}`, coords, progress: 0 });
      map.addSource(`route-${i}`, { type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({
        id: `route-${i}-glow`, type: 'line', source: `route-${i}`, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 10, 'line-blur': 7, 'line-gradient': routeGradient(0, 0.35), 'line-opacity': routeOpacity() },
      }, 'city-dots');
      map.addLayer({
        id: `route-${i}`, type: 'line', source: `route-${i}`, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 3, 'line-gradient': routeGradient(0, 1), 'line-opacity': routeOpacity() },
      }, 'city-dots');
    }
    map.getSource('route-all').setData({
      type: 'FeatureCollection',
      features: routeSegments.map((s) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s.coords } })),
    });
    map.getSource('city-dots').setData({
      type: 'FeatureCollection',
      features: points.map((p, i) => ({ type: 'Feature', id: i + 1, properties: { n: i + 1 }, geometry: { type: 'Point', coordinates: p } })),
    });
  }
  function setRouteProgress(i, p) {
    const seg = routeSegments[i];
    if (!seg || Math.abs(seg.progress - p) < 0.002) return;
    seg.progress = p;
    map.setPaintProperty(seg.id, 'line-gradient', routeGradient(p, 1));
    map.setPaintProperty(`${seg.id}-glow`, 'line-gradient', routeGradient(p, 0.35));
  }
  /** Reached cities get a solid dot; the rest a hollow one. */
  function setReached(n) {
    for (let i = 1; i <= 3; i++) map.setFeatureState({ source: 'city-dots', id: i }, { reached: i <= n ? 1 : 0 });
  }

  // ── Camera flights ──────────────────────────────────────────────────────────
  let flight = null;

  /**
   * Fly to a camera. While flying, `onFrame(k)` receives the eased progress 0…1, and the map's
   * padding eases to `padding` when one is given. A new flight cancels the previous one and
   * starts from wherever the camera is.
   */
  function flyTo(to, { duration = 4000, pitchDip = 26, padding, peakZoom, onFrame, onDone } = {}) {
    if (flight) flight.cancelled = true;
    const p0 = map.getPadding();
    const p1 = padding ?? p0;
    const padAt = (k) => ({ top: lerp(p0.top, p1.top, k), bottom: lerp(p0.bottom, p1.bottom, k), left: lerp(p0.left, p1.left, k), right: lerp(p0.right, p1.right, k) });
    if (reducedMotion) {
      map.jumpTo({ ...to, padding: p1 });
      onFrame?.(1);
      onDone?.();
      return;
    }
    const from = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    const path = vanWijk(map, from, to);
    const db = ((((to.bearing ?? from.bearing) - from.bearing) % 360) + 540) % 360 - 180;
    const toPitch = to.pitch ?? from.pitch;
    // Only dip the pitch on long flights; short hops stay in 3D.
    const dip = path.S > 1.2 || peakZoom != null ? pitchDip : 0;
    // peakZoom: pull back until at least this zoom mid-flight, so short hops still show where we are.
    let minZ = Infinity;
    for (let n = 0; n <= 40; n++) minZ = Math.min(minZ, path.at(n / 40).zoom);
    const extra = peakZoom != null ? Math.max(0, minZ - peakZoom) : 0;
    // A pull-back eases to a stop at its top (about a second) so the visitor sees where it is, then eases in.
    const pause = peakZoom != null;
    let kHold = 0.5;
    if (pause) {
      let zLow = Infinity;
      for (let n = 5; n <= 95; n++) {
        const z = path.at(n / 100).zoom - extra * Math.sin(Math.PI * (n / 100)) ** 1.4;
        if (z < zLow) { zLow = z; kHold = n / 100; }
      }
    }
    const t0 = performance.now();
    const ms = duration * clamp(0.55 + path.S * 0.18, 0.55, 1.25) * (peakZoom != null ? 1.15 : 1);
    const f = { cancelled: false };
    flight = f;
    const frame = () => {
      if (f.cancelled) return;
      const e = performance.now() - t0;
      let k;
      if (pause) {
        // ease out to the top, then ease in from it
        const t1 = ms * kHold;
        const t2 = ms * (1 - kHold);
        if (e < t1) { const u = clamp(e / t1, 0, 1); k = kHold * (1 - (1 - u) ** 2); }
        else { const u = clamp((e - t1) / t2, 0, 1); k = kHold + (1 - kHold) * u * u; }
      } else k = easeInOutCubic(clamp(e / ms, 0, 1));
      const at = path.at(k);
      const { center } = at;
      const zoom = at.zoom - extra * Math.sin(Math.PI * k) ** 1.4;
      const pitch = Math.max(0, lerp(from.pitch, toPitch, k) - dip * Math.sin(Math.PI * k) * (from.pitch > 20 || toPitch > 20 ? 1 : 0));
      map.jumpTo({ center, zoom, pitch: Math.min(pitch, 64), bearing: from.bearing + db * k, padding: padAt(k) });
      // second argument: progress of the zoom-in alone, so the route can wait until the camera starts dropping
      onFrame?.(k, pause ? clamp((k - kHold) / (1 - kHold), 0, 1) : k);
      if (k < 1) requestAnimationFrame(frame);
      else {
        flight = null;
        onDone?.();
      }
    };
    requestAnimationFrame(frame);
  }

  function fitAll(points, padding, viewPadding) {
    const lons = points.map((p) => p[0]), lats = points.map((p) => p[1]);
    const bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
    // a tall card on a phone leaves little free area: try smaller padding before falling back to the middle of the box
    // viewPadding: fit as if this were the map's padding (the closing view ignores the card and uses the whole height)
    const saved = map.getPadding();
    if (viewPadding) map.setPadding(viewPadding);
    let cam;
    for (const pad of [padding, 12, 0]) {
      try { cam = map.cameraForBounds(bounds, { padding: pad, bearing: 0 }); } catch { cam = null; } // throws when the padding leaves no room
      if (cam && Number.isFinite(cam.zoom) && Number.isFinite(cam.center?.lng ?? cam.center?.[0])) break;
      cam = null;
    }
    if (viewPadding) map.setPadding(saved);
    if (!cam) return { center: [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2], zoom: 4.2, pitch: 22, bearing: 0 };
    return { center: [cam.center.lng ?? cam.center[0], cam.center.lat ?? cam.center[1]], zoom: Math.min(cam.zoom, 6.2), pitch: 22, bearing: 0 };
  }

  return {
    map, ready, screenAt, setInteractive, addCity, cities, setTint, growCity,
    setRoute, setRouteProgress, setReached, flyTo, fitAll,
    isFlying: () => !!flight,
  };
}

// ── Style ─────────────────────────────────────────────────────────────────────
function baseStyle(europe) {
  const of = (layer) => ['==', ['get', 'layer'], layer];
  const zoomFadeOut = (a, b, max = 1) => ['interpolate', ['linear'], ['zoom'], a, max, b, 0];
  return {
    version: 8,
    name: 'Journey',
    light: { anchor: 'map', position: [1.2, 210, 42], color: '#ffffff', intensity: 0.3 },
    sky: {
      'sky-color': PALETTE.land, 'horizon-color': PALETTE.land, 'fog-color': PALETTE.land,
      'sky-horizon-blend': 0, 'horizon-fog-blend': 0, 'fog-ground-blend': 1, 'atmosphere-blend': 0,
    },
    sources: {
      europe: { type: 'geojson', data: europe, tolerance: 0.25 },
      'route-all': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'city-dots': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': PALETTE.sea } },
      { id: 'land', type: 'fill', source: 'europe', filter: of('land'), paint: { 'fill-color': PALETTE.land } },
      { id: 'urban', type: 'fill', source: 'europe', filter: of('urban'), paint: { 'fill-color': PALETTE.urban, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5.5, 0, 7, 1, 11.8, 1, 12.8, 0] } },
      { id: 'lakes', type: 'fill', source: 'europe', filter: of('lake'), paint: { 'fill-color': PALETTE.sea } },
      // Italy and the Netherlands, tinted and outlined, so the visitor can place each stop on the map
      { id: 'nl-tint', type: 'fill', source: 'europe', filter: of('country'), paint: { 'fill-color': PALETTE.highlight, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.32, 10.5, 0.32, 12, 0] } },
      {
        id: 'rivers', type: 'line', source: 'europe', filter: of('river'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PALETTE.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 9, 2.2], 'line-opacity': zoomFadeOut(11.5, 12.8) },
      },
      {
        id: 'borders', type: 'line', source: 'europe', filter: of('border'),
        layout: { 'line-join': 'round' },
        paint: { 'line-color': PALETTE.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 9, 1.6], 'line-dasharray': [3, 2], 'line-opacity': zoomFadeOut(10.5, 12) },
      },
      {
        id: 'nl-outline', type: 'line', source: 'europe', filter: of('country'),
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#5A7A34', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.2, 6, 1.8, 9, 2.6], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.9, 10.5, 0.9, 12, 0] },
      },
      // city flat layers are inserted here, before the route
      {
        id: 'route-ghost', type: 'line', source: 'route-all', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PALETTE.route, 'line-width': 1.6, 'line-dasharray': [1, 2.4], 'line-opacity': ['interpolate', ['linear'], ['zoom'], ROUTE_FADE[0], 0.45, ROUTE_FADE[1], 0] },
      },
      {
        id: 'city-dots', type: 'circle', source: 'city-dots',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 9, 7],
          'circle-color': ['case', ['==', ['coalesce', ['feature-state', 'reached'], 0], 1], PALETTE.route, '#ffffff'],
          'circle-stroke-color': PALETTE.route,
          'circle-stroke-width': 2.5,
          'circle-opacity': zoomFadeOut(ROUTE_FADE[0], ROUTE_FADE[1]),
          'circle-stroke-opacity': zoomFadeOut(ROUTE_FADE[0], ROUTE_FADE[1]),
        },
      },
    ],
  };
}

function routeOpacity() {
  return ['interpolate', ['linear'], ['zoom'], ROUTE_FADE[0], 1, ROUTE_FADE[1], 0];
}

function routeGradient(p, alpha) {
  const c = (a) => `rgba(132,224,36,${(a * alpha).toFixed(3)})`;
  if (p <= 0.001) return ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(132,224,36,0)', 1, 'rgba(132,224,36,0)'];
  if (p >= 0.999) return ['interpolate', ['linear'], ['line-progress'], 0, c(1), 1, c(1)];
  return ['interpolate', ['linear'], ['line-progress'], 0, c(0.9), Math.max(0.0005, p - 0.002), c(1), p, c(1), Math.min(0.9999, p + 0.0005), c(0), 1, c(0)];
}

/** A gently curved arc between two lon/lat points (bulging to the left of travel). */
function arc(a, b, n = 96) {
  const out = [];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bulge = Math.sin(Math.PI * t) * len * 0.12;
    out.push([a[0] + dx * t + nx * bulge, a[1] + dy * t + ny * bulge]);
  }
  return out;
}

/** van Wijk & Nuij smooth zoom-and-pan path, as used by MapLibre's flyTo. */
function vanWijk(map, from, to) {
  const tile = 512;
  const scale0 = 2 ** from.zoom;
  const p0 = maplibregl.MercatorCoordinate.fromLngLat(from.center);
  const p1 = maplibregl.MercatorCoordinate.fromLngLat(to.center);
  const px = (p) => [p.x * tile * scale0, p.y * tile * scale0];
  const [x0, y0] = px(p0), [x1, y1] = px(p1);
  const { clientWidth: W, clientHeight: H } = map.getContainer();
  const w0 = Math.max(W, H);
  const zoomTo = to.zoom ?? from.zoom;
  const w1 = w0 / 2 ** (zoomTo - from.zoom);
  const u1 = Math.hypot(x1 - x0, y1 - y0);
  const rho = 1.42, rho2 = rho * rho;
  const r = (i) => {
    const b = (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (i ? w1 : w0) * rho2 * u1);
    return Math.log(Math.sqrt(b * b + 1) - b);
  };
  let S, w, u;
  if (u1 < 1e-6) {
    S = Math.abs(Math.log(w1 / w0)) / rho;
    w = (s) => Math.exp((w1 < w0 ? -1 : 1) * rho * s);
    u = () => 0;
  } else {
    const r0 = r(0);
    S = (r(1) - r0) / rho;
    w = (s) => Math.cosh(r0) / Math.cosh(r0 + rho * s);
    u = (s) => (w0 * ((Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0)) / rho2)) / u1;
  }
  if (!Number.isFinite(S)) S = 0;
  return {
    S,
    at(k) {
      const s = k * S;
      const zoom = S ? from.zoom + Math.log2(1 / w(s)) : lerp(from.zoom, zoomTo, k);
      const f = S ? clamp(u(s), 0, 1) : k;
      const mx = lerp(p0.x, p1.x, f), my = lerp(p0.y, p1.y, f);
      const ll = new maplibregl.MercatorCoordinate(mx, my).toLngLat();
      return { center: [ll.lng, ll.lat], zoom: k >= 1 ? zoomTo : zoom };
    },
  };
}
