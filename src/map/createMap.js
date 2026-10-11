// MapLibre setup: the clay style, camera limits, rooftop projection for DOM pins,
// camera moves (focus, chapters, reset), the intro wave and the idle drift.

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { buildStyle } from './style.js';
import { CAMERA } from '../config.js';
import { clamp, lerp } from '../util/geo.js';
import { easeInOutCubic, easeOutCubic } from '../util/store.js';

maplibregl.setWorkerUrl(workerUrl);

export function createMap({ container, meta, data, eventBuildingIds, reducedMotion, cooperativeGestures = false }) {
  const [cw, cs, ce, cn] = meta.core.bounds;
  const slackLon = (ce - cw) * 0.06, slackLat = (cn - cs) * 0.06;
  let minZoomNow = CAMERA.minZoom - 1.4; // relaxed during the intro
  const listeners = { hover: new Set(), click: new Set(), interact: new Set() };
  const emit = (name, ...args) => listeners[name].forEach((fn) => fn(...args));

  const map = new maplibregl.Map({
    container,
    style: buildStyle({ meta, data, eventBuildingIds }),
    center: meta.focus,
    zoom: reducedMotion ? CAMERA.zoom : CAMERA.zoom - 1.25,
    pitch: reducedMotion ? CAMERA.pitch : 0,
    bearing: reducedMotion ? CAMERA.bearing : CAMERA.bearing + 24,
    minZoom: minZoomNow,
    maxZoom: CAMERA.maxZoom,
    minPitch: 0,
    maxPitch: CAMERA.maxPitch,
    renderWorldCopies: false,
    attributionControl: false,
    keyboard: false, // the app owns the keyboard shortcuts
    cooperativeGestures,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    fadeDuration: 0,
    validateStyle: false,
    canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' },
    // Pan stays inside the district; zoom stays in a readable range.
    transformConstrain: (lngLat, zoom) => ({
      center: new maplibregl.LngLat(
        clamp(lngLat.lng, cw - slackLon, ce + slackLon),
        clamp(lngLat.lat, cs - slackLat, cn + slackLat),
      ),
      zoom: clamp(zoom, minZoomNow, CAMERA.maxZoom),
    }),
  });
  map.setVerticalFieldOfView(CAMERA.fov);
  map.touchZoomRotate.enable();
  map.doubleClickZoom.enable();

  // A no-op custom layer whose only job is to capture the projection matrix each frame,
  // so DOM pins can sit on rooftops instead of at street level.
  const projector = {
    id: 'dispatch-projector',
    type: 'custom',
    renderingMode: '3d',
    matrix: null,
    onAdd() {},
    render(_gl, args) {
      this.matrix = args.defaultProjectionData?.mainMatrix ?? null;
    },
  };

  const ready = new Promise((resolve) => {
    map.once('style.load', () => {
      map.addLayer(projector);
      if (!reducedMotion) setGrowAll(0);
    });
    map.once('load', () => resolve());
  });

  // ── Projection ─────────────────────────────────────────────────────────────
  /** Screen position (CSS px) of a lon/lat at an altitude in metres. */
  function screenAt(lngLat, altitude = 0) {
    const ground = map.project(lngLat);
    const m = projector.matrix;
    if (!altitude || !m) return ground;
    // Project ground and roof with the captured matrix and add only the difference
    // to map.project(); the float32 error of the matrix cancels out.
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
    const dx = ((b[0] / b[2] - a[0] / a[2]) / 2) * W;
    const dy = (-(b[1] / b[2] - a[1] / a[2]) / 2) * H;
    return new maplibregl.Point(ground.x + dx, ground.y + dy);
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  const duration = (ms) => (reducedMotion ? 0 : ms);
  let pendingPadding = null; // applied together with the next camera move
  const withPadding = (opts) => {
    if (!pendingPadding) return opts;
    const o = { ...opts, padding: pendingPadding };
    pendingPadding = null;
    return o;
  };
  const home = () => ({ center: meta.focus, zoom: CAMERA.zoom, pitch: CAMERA.pitch, bearing: CAMERA.bearing });

  function focusBounds(bbox, { minZoom = 16.4, maxZoom = 18.3, ms = 1300 } = {}) {
    const [w, s, e, n] = bbox;
    if (pendingPadding) map.setPadding(pendingPadding); // cameraForBounds must fit inside the new free area
    pendingPadding = null;
    const cam = map.cameraForBounds([[w, s], [e, n]], { padding: 60, bearing: map.getBearing() });
    const zoom = clamp(cam?.zoom ?? CAMERA.zoom, minZoom, maxZoom);
    map.easeTo({ center: cam?.center ?? [(w + e) / 2, (s + n) / 2], zoom, duration: duration(ms), easing: easeInOutCubic, essential: true });
  }

  function focusPoint(lngLat, zoom, ms = 1300) {
    map.easeTo(withPadding({
      center: lngLat,
      zoom: clamp(zoom ?? Math.max(map.getZoom(), 17.2), CAMERA.minZoom, CAMERA.maxZoom),
      duration: duration(ms), easing: easeInOutCubic, essential: true,
    }));
  }

  function focusChapter(ch, ms = 1600) {
    if (!ch?.camera) return;
    // Chapter zoom in story.json is relative: 1 = the whole district, 2 = twice as close.
    const zoom = clamp(CAMERA.zoom + Math.log2(ch.camera.zoom ?? 1) * 0.8 - 0.1, CAMERA.minZoom, CAMERA.maxZoom);
    map.easeTo(withPadding({
      center: ch.camera.target, zoom,
      ...(ch.camera.bearing != null ? { bearing: ch.camera.bearing } : {}),
      ...(ch.camera.pitch != null ? { pitch: ch.camera.pitch } : {}),
      duration: duration(ms), easing: easeInOutCubic, essential: true,
    }));
  }

  function resetView() {
    map.easeTo(withPadding({ ...home(), duration: duration(1200), easing: easeInOutCubic, essential: true }));
  }

  function zoomBy(delta) {
    map.easeTo({ zoom: map.getZoom() + delta, duration: duration(350), essential: true });
  }

  /** mode: 'animate' eases to the new padding, 'instant' sets it, 'next' defers it to the next camera move. */
  function setPadding(padding, mode = 'animate') {
    const cur = map.getPadding();
    if (['top', 'bottom', 'left', 'right'].every((k) => Math.abs((cur[k] ?? 0) - (padding[k] ?? 0)) < 1)) return;
    if (mode === 'next') pendingPadding = padding;
    else if (mode === 'animate' && !reducedMotion && !map.isMoving()) map.easeTo({ padding, duration: 450, easing: easeInOutCubic });
    else map.setPadding(padding);
  }

  // Keep the bearing within a narrow arc around the default view.
  map.on('rotate', () => {
    if (introRunning) return;
    const b = map.getBearing();
    const lo = CAMERA.bearing - CAMERA.bearingRange, hi = CAMERA.bearing + CAMERA.bearingRange;
    if (b < lo - 0.01 || b > hi + 0.01) map.setBearing(clamp(b, lo, hi));
  });

  // ── Intro: camera eases down while buildings grow in a wave from the focus point ─
  let introRunning = false;
  const buildingDelays = data.buildings.features.map((f) => [f.properties.fid, f.properties.delay]);
  const treeDelays = data.treeSolids.features.map((f) => [f.properties.fid, f.properties.delay]);

  function setGrowAll(v) {
    for (const [fid] of buildingDelays) map.setFeatureState({ source: 'buildings', id: fid }, { grow: v });
    for (const [fid] of treeDelays) map.setFeatureState({ source: 'trees', id: fid }, { grow: v });
  }

  function runIntro({ replay = false } = {}) {
    if (reducedMotion) {
      finishIntro();
      return Promise.resolve();
    }
    if (replay) {
      minZoomNow = CAMERA.minZoom - 1.4;
      map.setMinZoom(minZoomNow);
      map.setMinPitch(0);
      map.jumpTo({ center: meta.focus, zoom: CAMERA.zoom - 1.25, pitch: 0, bearing: CAMERA.bearing + 24 });
      setGrowAll(0);
    }
    introRunning = true;
    const total = 2700;
    map.easeTo({ ...home(), duration: total, easing: easeInOutCubic });
    const levels = 14;
    const last = new Map();
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const T = clamp((performance.now() - t0) / (total + 500), 0, 1);
        const wave = (list, source) => {
          for (const [fid, delay] of list) {
            const g = easeOutCubic(clamp((T * 1.55 - delay * 1.05) / 0.5, 0, 1));
            const q = Math.round(g * levels) / levels;
            const key = `${source}${fid}`;
            if (last.get(key) !== q) {
              last.set(key, q);
              map.setFeatureState({ source, id: fid }, { grow: q });
            }
          }
        };
        wave(buildingDelays, 'buildings');
        wave(treeDelays, 'trees');
        if (T < 1) requestAnimationFrame(step);
        else {
          finishIntro();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  function finishIntro() {
    introRunning = false;
    minZoomNow = CAMERA.minZoom;
    map.setMinZoom(CAMERA.minZoom);
    map.setMinPitch(CAMERA.minPitch);
    setGrowAll(1);
  }

  // ── Idle drift: a barely-there sway after a while without input ──────────────
  let lastInput = performance.now();
  let drift = null;
  let driftAllowed = () => true;
  const onInput = () => {
    lastInput = performance.now();
    if (drift) stopDrift();
  };
  for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart']) window.addEventListener(ev, onInput, { passive: true });
  // Only gestures count as "the reader took the camera"; programmatic eases carry no originalEvent.
  for (const name of ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart']) {
    map.on(name, (e) => { if (e.originalEvent) emit('interact', name); });
  }

  function stopDrift() {
    if (!drift) return;
    cancelAnimationFrame(drift.raf);
    drift = null;
  }
  if (!reducedMotion) {
    setInterval(() => {
      if (drift || introRunning || map.isMoving() || document.hidden || !driftAllowed()) return;
      if (performance.now() - lastInput < 9000) return;
      const base = map.getBearing();
      const start = performance.now();
      drift = { raf: 0 };
      const loop = () => {
        if (!drift) return;
        const s = (performance.now() - start) / 1000;
        const env = Math.min(1, s / 4) * Math.min(1, Math.max(0, (60 - s) / 4)); // ease in/out, stop after a minute
        map.setBearing(base + Math.sin((s / 34) * Math.PI * 2) * 2.4 * env);
        if (s >= 60) {
          drift = null;
          lastInput = performance.now() + 120000; // rest for a while
          return;
        }
        drift.raf = requestAnimationFrame(loop);
      };
      drift.raf = requestAnimationFrame(loop);
    }, 1000);
  }

  // ── Picking: only event buildings are interactive ────────────────────────────
  let hoveredFid = null;
  const pick = (point) => map.queryRenderedFeatures(point, { layers: ['event-buildings'] })[0] ?? null;
  map.on('mousemove', (e) => {
    const f = pick(e.point);
    const fid = f?.id ?? null;
    if (fid !== hoveredFid) {
      hoveredFid = fid;
      emit('hover', f ? f.properties.id : null, e.point);
    } else if (f) emit('hover', f.properties.id, e.point);
  });
  map.on('mouseout', () => {
    if (hoveredFid != null) emit('hover', null);
    hoveredFid = null;
  });
  map.on('click', (e) => {
    const f = pick(e.point);
    emit('click', f ? f.properties.id : null, e.point);
  });

  // ── Street highlight for search results ─────────────────────────────────────
  let highlightTimer = null;
  ready.then(() => {
    map.addLayer({
      id: 'street-highlight', type: 'line', source: 'roads',
      filter: ['==', ['get', 'name'], '__none__'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#3B5BFF', 'line-opacity': 0, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 2, 20, 24] },
    }, 'trees');
  });
  function highlightStreet(name) {
    clearTimeout(highlightTimer);
    map.setFilter('street-highlight', ['==', ['get', 'name'], name]);
    map.setPaintProperty('street-highlight', 'line-opacity', 0.55);
    highlightTimer = setTimeout(() => map.setPaintProperty('street-highlight', 'line-opacity', 0), 4500);
  }

  // The story owns the wheel and the drag until the reader chooses to explore the map.
  const gestures = ['scrollZoom', 'dragPan', 'dragRotate', 'touchZoomRotate', 'doubleClickZoom', 'touchPitch'];
  function setFreeNavigation(on) {
    for (const g of gestures) map[g]?.[on ? 'enable' : 'disable']();
  }
  setFreeNavigation(false);

  return {
    map,
    setFreeNavigation,
    ready,
    screenAt,
    focusBounds,
    focusPoint,
    focusChapter,
    resetView,
    zoomBy,
    setPadding,
    runIntro,
    highlightStreet,
    isIntroRunning: () => introRunning,
    setDriftAllowed: (fn) => { driftAllowed = fn; },
    on(name, fn) {
      listeners[name].add(fn);
      return () => listeners[name].delete(fn);
    },
    lerp,
  };
}
