// The static "clay" city as a MapLibre style built entirely from our own OSM GeoJSON.
// No basemap tiles, no glyphs, no sprites, no API keys.

import { COLORS } from '../config.js';

/** Paint expression that keeps a width in metres at every zoom (512 px tiles). */
export function metres(lat) {
  const pxPerMetreAtZ0 = 1 / (78271.51696 * Math.cos((lat * Math.PI) / 180));
  return (value) => [
    'interpolate', ['exponential', 2], ['zoom'],
    12, ['*', value, pxPerMetreAtZ0 * 2 ** 12],
    23, ['*', value, pxPerMetreAtZ0 * 2 ** 23],
  ];
}

// Buildings and trees "melt" into the ground at the district edge.
const edgeShrink = ['-', 1, ['*', 0.92, ['get', 'fade']]];
const grow = ['coalesce', ['feature-state', 'grow'], 1];

export function buildStyle({ meta, data, eventBuildingIds }) {
  const m = metres(meta.origin[1]);
  const isEvent = ['in', ['get', 'id'], ['literal', eventBuildingIds]];
  const tint = ['coalesce', ['feature-state', 'tint'], 0];
  const hover = ['coalesce', ['feature-state', 'hover'], 0];
  const role = ['coalesce', ['feature-state', 'role'], 0];
  const roleColor = (base, strong) => [
    'interpolate', ['linear'], ['+', tint, ['*', 0.35, hover]],
    0, COLORS.clay, 1, base, 1.35, strong,
  ];

  return {
    version: 8,
    name: 'Storyline clay',
    light: {
      anchor: 'map',
      position: [1.2, meta.sun.azimuth, 90 - meta.sun.elevation],
      color: '#ffffff',
      intensity: 0.3,
    },
    sky: {
      'sky-color': COLORS.bg, 'horizon-color': COLORS.bg, 'fog-color': COLORS.bg,
      'sky-horizon-blend': 0, 'horizon-fog-blend': 0, 'fog-ground-blend': 1, 'atmosphere-blend': 0,
    },
    transition: { duration: 0, delay: 0 },
    sources: {
      green: { type: 'geojson', data: data.green },
      water: { type: 'geojson', data: data.water },
      roads: { type: 'geojson', data: data.roads },
      rail: { type: 'geojson', data: data.rail },
      lighting: { type: 'image', url: `data/${meta.lighting.image}`, coordinates: meta.lighting.coordinates },
      buildings: { type: 'geojson', data: data.buildings, promoteId: 'fid' },
      trees: { type: 'geojson', data: data.treeSolids, promoteId: 'fid' },
      outside: { type: 'geojson', data: outsideMask(meta.lighting.coordinates) },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': COLORS.bg } },
      { id: 'green', type: 'fill', source: 'green', paint: { 'fill-color': COLORS.green, 'fill-antialias': true } },
      {
        id: 'squares', type: 'fill', source: 'roads',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': COLORS.square },
      },
      { id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': COLORS.water } },
      { id: 'water-edge', type: 'line', source: 'water', paint: { 'line-color': COLORS.waterEdge, 'line-width': m(1.1) } },
      {
        id: 'roads-minor', type: 'line', source: 'roads',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'minor'], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLORS.roadMinor, 'line-width': m(['get', 'w']) },
      },
      {
        id: 'roads', type: 'line', source: 'roads',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'minor'], true]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLORS.road, 'line-width': m(['get', 'w']) },
      },
      {
        id: 'rail', type: 'line', source: 'rail',
        paint: { 'line-color': COLORS.rail, 'line-width': m(0.24), 'line-gap-width': m(1.435) },
      },
      // Baked sun shadows, contact shading and the soft fade of the district edge.
      {
        id: 'lighting', type: 'raster', source: 'lighting',
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      },
      // Everything outside the fetched area is painted over with the background.
      { id: 'outside', type: 'fill', source: 'outside', paint: { 'fill-color': COLORS.bg } },
      // ── story ground overlays are inserted here, before "trees" ──
      {
        id: 'trees', type: 'fill-extrusion', source: 'trees',
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'fade'],
            0, ['match', ['get', 'part'], 'trunk', COLORS.trunk, COLORS.tree],
            1, COLORS.clayFar,
          ],
          'fill-extrusion-base': ['*', ['get', 'base'], edgeShrink, grow],
          'fill-extrusion-height': ['*', ['get', 'top'], edgeShrink, grow],
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'buildings', type: 'fill-extrusion', source: 'buildings',
        filter: ['!', isEvent],
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'fade'], 0, COLORS.clay, 1, COLORS.clayFar],
          'fill-extrusion-height': ['*', ['get', 'h'], edgeShrink, grow],
          'fill-extrusion-base': 0,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'event-buildings', type: 'fill-extrusion', source: 'buildings',
        filter: isEvent,
        paint: {
          'fill-extrusion-color': [
            'match', role,
            1, roleColor(COLORS.coralTint, COLORS.coral),
            2, roleColor(COLORS.amberTint, COLORS.amber),
            roleColor(COLORS.blueTint, COLORS.blue),
          ],
          'fill-extrusion-height': ['*', ['get', 'h'], ['+', 1, ['*', 0.08, hover]], grow],
          'fill-extrusion-base': 0,
          'fill-extrusion-vertical-gradient': true,
        },
      },
    ],
  };
}

/**
 * Trees as soft stacked "lollipops": a thin trunk and three crown tiers (narrow, wide, narrow)
 * so each crown reads as a rounded clay blob at street scale.
 */
export function treeSolids(trees, local, circleRing, focusXY) {
  const features = [];
  let fid = 1;
  for (const f of trees.features) {
    const { h, crown, fade } = f.properties;
    const c = local.toXY(f.geometry.coordinates);
    const r = crown / 2;
    const delay = Math.min(1, Math.hypot(c[0] - focusXY[0], c[1] - focusXY[1]) / 620);
    const parts = [
      ['trunk', 0.22, 0, h * 0.42, 6],
      ['crown', r * 0.62, h * 0.36, h * 0.5, 10],
      ['crown', r, h * 0.5, h * 0.83, 12],
      ['crown', r * 0.6, h * 0.83, h, 10],
    ];
    for (const [part, rad, base, top, sides] of parts) {
      features.push({
        type: 'Feature',
        properties: { fid: fid++, part, base, top, fade, delay },
        geometry: { type: 'Polygon', coordinates: [circleRing(local, c, rad, sides, (fid % 7) * 0.4)] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** A world-sized polygon with a hole the size of the fetched area. */
function outsideMask(corners) {
  const hole = [...corners, corners[0]].slice().reverse();
  const world = [[-179, -85], [179, -85], [179, 85], [-179, 85], [-179, -85]];
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, hole] } };
}
