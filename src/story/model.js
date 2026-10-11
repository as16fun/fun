// Turns /data/story.json into the normalised model the app works with.
// A newsroom can swap the JSON; nothing in here is specific to the demo story.

import { parseStoryTime } from '../util/time.js';
import { bboxOf, ringCentroid } from '../util/geo.js';
import { CONFIDENCE, EVENT_TYPES, SOURCE_TYPES } from '../config.js';

/**
 * @param {object} raw            parsed story.json
 * @param {object} ctx
 * @param {(lonlat:number[]) => number[]} ctx.toXY   lon/lat → local metres
 * @param {Map<string, {centroid:number[], h:number}>} ctx.buildings  OSM building id → roof info
 */
export function buildModel(raw, { toXY, buildings }) {
  const story = raw.story;
  const T = (v) => parseStoryTime(v, story);
  const start = T(story.start);
  const end = T(story.end);
  const registry = new Map((raw.sources ?? []).map((s) => [s.id, s]));

  const events = (raw.events ?? [])
    .map((e) => normaliseEvent(e))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  events.forEach((e, i) => { e.n = i + 1; });
  const byId = new Map(events.map((e) => [e.id, e]));

  const chapters = (raw.chapters ?? [])
    .map((c) => ({
      ...c,
      start: T(c.start),
      camera: c.camera ? { target: c.camera.target, zoom: c.camera.zoom, bearing: c.camera.bearing, pitch: c.camera.pitch } : null,
    }))
    .sort((a, b) => a.start - b.start);
  chapters.forEach((c, i) => {
    c.index = i;
    c.end = chapters[i + 1]?.start ?? end;
    c.events = events.filter((e) => e.start >= c.start && e.start < c.end).map((e) => e.id);
  });
  for (const e of events) e.chapter = chapters.find((c) => e.start >= c.start && e.start < c.end)?.id ?? chapters.at(-1)?.id;

  const sources = [...registry.values()].map((s) => ({
    ...s,
    typeLabel: SOURCE_TYPES[s.type] ?? s.type,
    citedBy: events.filter((e) => e.sources.some((r) => r.id === s.id)).map((e) => e.id),
  }));

  return { story, start, end, events, byId, chapters, sources, registry };

  function normaliseEvent(e) {
    if (!e?.id || e.time == null) {
      console.warn('Skipping event without id/time', e);
      return null;
    }
    const time = typeof e.time === 'object' ? e.time : { start: e.time };
    const s = T(time.start);
    const en = time.end != null ? T(time.end) : s;
    const buildingIds = [...new Set([...(e.buildingIds ?? []), ...(e.buildingId ? [e.buildingId] : [])])]
      .filter((id) => {
        if (buildings.has(id)) return true;
        console.warn(`Event ${e.id}: building ${id} is not in buildings.geojson`);
        return false;
      });
    const geom = normaliseLocation(e.location ?? {}, buildingIds);
    if (!geom) {
      console.warn(`Event ${e.id}: unsupported or empty location`, e.location);
      return null;
    }
    const conf = CONFIDENCE[e.confidence] ? e.confidence : 'unverified';
    return {
      id: e.id,
      title: e.title,
      summary: e.summary ?? '',
      type: EVENT_TYPES[e.type] ? e.type : 'statement',
      typeLabel: EVENT_TYPES[e.type] ?? e.type,
      place: e.place ?? '',
      start: s,
      end: Math.max(s, en),
      isRange: en > s,
      confidence: conf,
      confidenceNote: e.confidenceNote ?? '',
      quote: e.quote ?? null,
      buildingIds,
      geom,
      crowd: normaliseCrowd(e.crowd, s, Math.max(s, en), e.type),
      sources: (e.sources ?? []).map((ref) => {
        const src = registry.get(ref.source) ?? {};
        return {
          id: ref.source ?? null,
          name: ref.name ?? src.name ?? 'Unnamed source',
          type: ref.type ?? src.type ?? 'other',
          typeLabel: SOURCE_TYPES[ref.type ?? src.type] ?? ref.type ?? src.type ?? 'Source',
          reliability: ref.reliability ?? src.reliability ?? null,
          note: src.note ?? '',
          detail: ref.detail ?? '',
          link: ref.link ?? src.link ?? null,
          timestamp: ref.timestamp != null ? T(ref.timestamp) : null,
        };
      }),
    };
  }

  function normaliseLocation(loc, buildingIds) {
    // Accept both the Storyline shorthand and plain GeoJSON geometry objects.
    let type = loc.type;
    let coords = loc.coordinates ?? loc.via ?? null;
    if (type === 'Point') type = 'point';
    if (type === 'LineString') type = 'path';
    if (type === 'MultiLineString') type = 'paths';
    if (type === 'Polygon') { type = 'area'; coords = coords?.[0]; }
    if (!coords) {
      if (!buildingIds.length) return null;
      coords = buildings.get(buildingIds[0]).lonlat;
      type = 'point';
    }

    const g = { kind: type === 'paths' ? 'path' : type, lines: null, ring: null, point: null };
    if (type === 'point') g.point = coords;
    else if (type === 'path') g.lines = [coords];
    else if (type === 'paths') g.lines = coords;
    else if (type === 'area') g.ring = coords;
    else return null;
    g.width = loc.width ?? null;

    // Pin anchor: explicit anchor on the street › roof of the linked building › geometry.
    let anchor, altitude = 0;
    if (loc.anchor) anchor = loc.anchor;
    else if (buildingIds.length) {
      const b = buildings.get(buildingIds[0]);
      anchor = b.lonlat;
      altitude = Math.max(...buildingIds.map((id) => buildings.get(id).h));
    } else if (g.point) anchor = g.point;
    else if (g.lines) anchor = g.lines[0][0];
    else {
      const c = ringCentroid(g.ring.map(toXY));
      anchor = centroidLonLat(g.ring, c);
    }
    g.anchor = anchor;
    g.altitude = altitude;
    g.bbox = bboxOf([g.point ?? [], g.lines ?? [], g.ring ?? [], anchor].filter((x) => x.length));
    return g;
  }

  // The centroid in metres mapped back proportionally onto the ring's lon/lat bbox.
  function centroidLonLat(ring, cxy) {
    const xy = ring.map(toXY);
    const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
    const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
    const fx = (cxy[0] - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs) || 1);
    const fy = (cxy[1] - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys) || 1);
    return [
      Math.min(...lons) + fx * (Math.max(...lons) - Math.min(...lons)),
      Math.min(...lats) + fy * (Math.max(...lats) - Math.min(...lats)),
    ];
  }

  function normaliseCrowd(c, s, en, type) {
    if (!c || c.estimate == null) return null;
    const peak = { estimate: c.estimate, low: c.low ?? c.estimate, high: c.high ?? c.estimate };
    let series = null;
    if (c.series?.length) {
      series = c.series
        .map((k) => ({ t: T(k.time), estimate: k.estimate, low: k.low ?? k.estimate, high: k.high ?? k.estimate }))
        .sort((a, b) => a.t - b.t);
    } else if (type !== 'movement') {
      const d = Math.max(1, en - s);
      const zero = { estimate: 0, low: 0, high: 0 };
      series = [
        { t: s, ...zero }, { t: s + d * 0.2, ...peak }, { t: en - d * 0.2, ...peak }, { t: en, ...zero },
      ];
    }
    return {
      ...peak,
      series,
      claims: (c.claims ?? []).map((cl) => ({
        ...cl,
        name: registry.get(cl.source)?.name ?? cl.source,
        timestamp: cl.timestamp != null ? T(cl.timestamp) : null,
      })),
    };
  }
}
