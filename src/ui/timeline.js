// Bottom timeline: play/pause, speed, a scrubber with event ticks (styled by confidence),
// chapter markers, the selected moment and a large clock. Dragging scrubs the map live.

import { h, frag, rafThrottle } from '../util/dom.js';
import { ICONS, GLYPHS } from './icons.js';
import { CONFIDENCE, PLAYBACK } from '../config.js';
import { fmtClock, fmtStoryDate, zoneLabel } from '../util/time.js';
import { clamp } from '../util/geo.js';

export function createTimeline({ root, model, store, onSelect, onScrubStart }) {
  const span = model.end - model.start;
  const frac = (t) => (t - model.start) / span;

  const playBtn = h('button.tl-play', { type: 'button', 'aria-label': 'Play', title: 'Play / pause (Space)' }, frag(ICONS.play));
  const speedGroup = h('div.tl-speed', { role: 'radiogroup', 'aria-label': 'Playback speed' },
    PLAYBACK.speeds.map((s) => h('button', {
      type: 'button', role: 'radio', dataset: { speed: s }, 'aria-checked': 'false',
      title: s === 1 ? '1×: one story-minute per second' : `${s}× faster`,
    }, `${s}×`)));

  const ticks = h('div.tl-ticks', { 'aria-hidden': 'true' });
  const ranges = h('div.tl-ranges', { 'aria-hidden': 'true' });
  const chapterMarks = h('div.tl-chapters');
  const fill = h('div.tl-fill');
  const selMark = h('div.tl-selected', { hidden: true }, h('span'));
  const thumb = h('div.tl-thumb', { 'aria-hidden': 'true' });
  const hoverTip = h('div.tl-tip', { hidden: true, 'aria-hidden': 'true' });
  const track = h('div.tl-track',
    {
      role: 'slider', tabindex: '0',
      'aria-label': 'Story time',
      'aria-valuemin': String(Math.round(model.start)), 'aria-valuemax': String(Math.round(model.end)),
    },
    h('div.tl-rail', fill), ranges, ticks, selMark, thumb);
  const scrubber = h('div.tl-scrubber', chapterMarks, track, hoverTip,
    h('div.tl-scale', { 'aria-hidden': 'true' }, hourLabels()));

  const clock = h('div.tl-clock', { 'aria-live': 'off' },
    h('span.tl-time', fmtClock(model.start)),
    h('span.tl-date', `${fmtStoryDate(model.story, { weekday: 'short', day: 'numeric', month: 'short' })} · ${zoneLabel(model.story)}`));

  const el = h('section.timeline', { 'aria-label': 'Timeline' },
    h('div.tl-controls', playBtn, speedGroup), scrubber, clock);
  root.append(el);

  // Event ticks, with a thin bar for events that span a time range.
  for (const e of model.events) {
    const tick = h('button.tl-tick', {
      type: 'button', tabindex: '-1',
      dataset: { conf: e.confidence, id: e.id },
      style: { left: `${frac(e.start) * 100}%` },
      title: `${e.n}. ${e.title}, ${fmtClock(e.start)} · ${CONFIDENCE[e.confidence].label}`,
    }, h('span.tl-tick-glyph', frag(GLYPHS[e.confidence])));
    tick.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    tick.addEventListener('click', () => onSelect(e.id, 'timeline'));
    ticks.append(tick);
    if (e.isRange) {
      ranges.append(h('div.tl-range', {
        dataset: { conf: e.confidence },
        style: { left: `${frac(e.start) * 100}%`, width: `${((e.end - e.start) / span) * 100}%` },
      }));
    }
  }
  for (const c of model.chapters) {
    chapterMarks.append(h('button.tl-chapter', {
      type: 'button', tabindex: '-1', dataset: { id: c.id },
      style: { left: `${frac(c.start) * 100}%` },
      'aria-label': `Chapter ${c.index + 1}: ${c.title} (${fmtClock(c.start)})`,
      onclick: () => store.set({ t: c.start, playing: false, chapterJump: c.id }),
    }, h('span.tl-chapter-n', String(c.index + 1)), h('span.tl-chapter-title', c.title)));
  }

  function hourLabels() {
    const out = [];
    for (let m = Math.ceil(model.start / 60) * 60; m <= model.end; m += 60) {
      out.push(h('span', { style: { left: `${frac(m) * 100}%` } }, fmtClock(m)));
    }
    return out;
  }

  // ── Interaction ─────────────────────────────────────────────────────────────
  const timeAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return model.start + clamp((clientX - r.left) / r.width, 0, 1) * span;
  };
  let dragging = false;
  track.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    track.setPointerCapture(ev.pointerId);
    el.classList.add('is-scrubbing');
    onScrubStart?.();
    store.set({ t: timeAt(ev.clientX), playing: false });
  });
  const move = rafThrottle((clientX) => store.set({ t: timeAt(clientX) }));
  track.addEventListener('pointermove', (ev) => {
    if (dragging) move(ev.clientX);
  });
  const end = (ev) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('is-scrubbing');
    try { track.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);

  scrubber.addEventListener('pointermove', (ev) => {
    const t = timeAt(ev.clientX);
    const near = model.events.reduce((best, e) => (Math.abs(e.start - t) < Math.abs((best?.start ?? Infinity) - t) ? e : best), null);
    const snap = near && Math.abs(near.start - t) < span * 0.012 ? near : null;
    hoverTip.hidden = false;
    hoverTip.textContent = snap ? `${fmtClock(snap.start)} · ${snap.n}. ${snap.title}` : fmtClock(t);
    const r = scrubber.getBoundingClientRect();
    hoverTip.style.left = `${clamp(ev.clientX - r.left, 60, r.width - 60)}px`;
  });
  scrubber.addEventListener('pointerleave', () => { hoverTip.hidden = true; });

  track.addEventListener('keydown', (ev) => {
    const { t } = store.get();
    const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
    let next = null;
    if (ev.key in steps) next = t + steps[ev.key] * (ev.shiftKey ? 5 : 1);
    if (ev.key === 'Home') next = model.start;
    if (ev.key === 'End') next = model.end;
    if (next == null) return;
    ev.preventDefault();
    ev.stopPropagation();
    store.set({ t: clamp(next, model.start, model.end), playing: false });
  });

  playBtn.addEventListener('click', () => togglePlay());
  speedGroup.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-speed]');
    if (b) store.set({ speed: Number(b.dataset.speed) });
  });
  speedGroup.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    ev.preventDefault();
    const i = PLAYBACK.speeds.indexOf(store.get().speed);
    const next = PLAYBACK.speeds[clamp(i + (ev.key === 'ArrowRight' ? 1 : -1), 0, PLAYBACK.speeds.length - 1)];
    store.set({ speed: next });
    speedGroup.querySelector(`[data-speed="${next}"]`)?.focus();
  });

  function togglePlay() {
    const s = store.get();
    if (s.playing) store.set({ playing: false });
    else store.set({ playing: true, t: s.t >= model.end - 0.01 ? model.start : s.t });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  let shownPlaying = null;
  function update(st, s) {
    const f = clamp(frac(st.t), 0, 1) * 100;
    fill.style.width = `${f}%`;
    thumb.style.left = `${f}%`;
    clock.firstChild.textContent = fmtClock(st.t);
    track.setAttribute('aria-valuenow', String(Math.round(st.t)));
    track.setAttribute('aria-valuetext', `${fmtClock(st.t)}, ${st.visible} of ${model.events.length} events`);
    // Swap the icon only when play/pause actually changes: redrawing it every frame while playing
    // removed the element under the pointer mid-click, so some Pause clicks were lost.
    if (s.playing !== shownPlaying) {
      shownPlaying = s.playing;
      playBtn.replaceChildren(frag(s.playing ? ICONS.pause : ICONS.play));
      playBtn.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      playBtn.classList.toggle('is-playing', s.playing);
    }
    for (const b of speedGroup.children) {
      const on = Number(b.dataset.speed) === s.speed;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const tick of ticks.children) {
      const e = model.byId.get(tick.dataset.id);
      tick.classList.toggle('is-past', st.t >= e.start);
      tick.classList.toggle('is-selected', s.selectedId === e.id);
    }
    for (const c of chapterMarks.children) {
      c.classList.toggle('is-active', model.chapters[st.chapterIndex]?.id === c.dataset.id);
    }
    const sel = s.selectedId ? model.byId.get(s.selectedId) : null;
    selMark.hidden = !sel;
    if (sel) {
      selMark.style.left = `${frac(sel.start) * 100}%`;
      selMark.firstChild.textContent = fmtClock(sel.start);
      selMark.dataset.conf = sel.confidence;
    }
  }

  return { el, update, togglePlay };
}
