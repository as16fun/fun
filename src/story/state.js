// The single state function: everything the map and UI show at time t is derived here
// from the story data. Scrubbing, playing and jumping all call computeState(model, t).

import { clamp01, smoothstep } from '../util/geo.js';

export function computeState(model, t) {
  const ev = new Map();
  let visible = 0;
  let confirmed = 0;
  let latest = null;

  for (const e of model.events) {
    const vis = t >= e.start - 1e-6;
    const dur = e.end - e.start;
    ev.set(e.id, {
      vis,
      // ongoing: inside the time range, or within 12 minutes of a point event
      ongoing: vis && (dur > 0 ? t <= e.end : t - e.start < 12),
      progress: dur > 0 ? clamp01((t - e.start) / dur) : vis ? 1 : 0,
      appear: smoothstep(e.start, e.start + 3, t),
      fadeOut: dur > 0 ? 1 - smoothstep(e.end, e.end + 6, t) : 1,
      crowd: e.crowd ? crowdAt(e, t) : null,
      age: t - e.start,
    });
    if (vis) {
      visible++;
      if (e.confidence === 'confirmed') confirmed++;
      latest = e;
    }
  }

  let chapterIndex = 0;
  model.chapters.forEach((c, i) => { if (t >= c.start - 1e-6) chapterIndex = i; });
  const ch = model.chapters[chapterIndex];
  const chapterProgress = ch ? clamp01((t - ch.start) / Math.max(1, ch.end - ch.start)) : 0;

  return { t, ev, visible, confirmed, latest, chapterIndex, chapterProgress };
}

/** Crowd estimate with its low/high range at time t, linearly interpolated between keyframes. */
export function crowdAt(e, t) {
  const c = e.crowd;
  const zero = { estimate: 0, low: 0, high: 0 };
  if (!c.series) {
    return t >= e.start && t <= e.end ? { estimate: c.estimate, low: c.low, high: c.high } : zero;
  }
  const s = c.series;
  if (t < s[0].t) return zero;
  if (t >= s[s.length - 1].t) return { estimate: s.at(-1).estimate, low: s.at(-1).low, high: s.at(-1).high };
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return {
        estimate: a.estimate + (b.estimate - a.estimate) * f,
        low: a.low + (b.low - a.low) * f,
        high: a.high + (b.high - a.high) * f,
      };
    }
  }
  return zero;
}

/** Event ids in chronological order around t, for the ← / → shortcuts. */
export function neighbourEvent(model, t, dir) {
  const eps = 0.01;
  if (dir > 0) return model.events.find((e) => e.start > t + eps) ?? null;
  return [...model.events].reverse().find((e) => e.start < t - eps) ?? null;
}
