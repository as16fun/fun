// The story panel: headline, current moment, chapters, event feed and sources.
// "Follow story" turns the chapters into scroll-driven steps that move the timeline;
// "Explore freely" shows a compact chapter list and a feed of what has happened so far.
// On mobile the same panel becomes a draggable bottom sheet with three snap points.

import { h, frag, rafThrottle } from '../util/dom.js';
import { ICONS } from './icons.js';
import { eventCard, typeIcon } from './cards.js';
import { fmtClock } from '../util/time.js';
import { clamp } from '../util/geo.js';

const READING_LINE = 0.34; // fraction of the scroll viewport where "now" is read

export function createPanel({ root, model, store, onSelect, onChapter }) {
  const story = model.story;

  const head = h('header.story-head',
    h('h1.story-title', story.title),
    h('p.story-standfirst', story.standfirst));


  const timeChip = h('span.time-chip', frag(ICONS.clock), h('span.time-chip-value', fmtClock(model.start)));
  const summary = h('span.status-summary');
  const modeBtn = (mode, icon, label) => h('button', { type: 'button', role: 'radio', dataset: { mode }, 'aria-checked': 'false' }, frag(ICONS[icon]), label);
  const modeGroup = h('div.mode-toggle', { role: 'radiogroup', 'aria-label': 'Reading mode' },
    modeBtn('follow', 'scroll', 'Follow story'), modeBtn('explore', 'compass', 'Explore freely'));
  const modeHint = h('p.mode-hint');
  const status = h('div.status', h('div.status-row', timeChip, summary), modeGroup, modeHint);

  // ── Chapters: scrolly steps (follow) and a compact list (explore) ───────────
  const steps = h('ol.steps');
  const chapterList = h('ol.chapter-list');
  const stepEls = model.chapters.map((c) => {
    const evWrap = h('div.step-events');
    const li = h('li.step', { dataset: { id: c.id } },
      h('div.step-meta', h('span.step-n', `Ch ${c.index + 1}`), h('span.step-time', `${fmtClock(c.start)}–${fmtClock(c.end)}`)),
      h('h3.step-title', c.title),
      h('p.step-summary', c.summary),
      evWrap,
      h('p.step-upcoming'));
    steps.append(li);
    const row = h('li', h('button.chapter-row', { type: 'button', dataset: { id: c.id }, onclick: () => onChapter(c) },
      h('span.step-n', `Ch ${c.index + 1}`),
      h('span.chapter-text', h('span.chapter-title', c.title), h('span.chapter-time', fmtClock(c.start))),
      h('span.chapter-bar', h('span'))));
    chapterList.append(row);
    return { c, li, evWrap, row, cards: new Map() };
  });
  const stepsEnd = h('div.steps-end',
    h('p', 'End of the evening.'),
    h('button.btn.ghost.small', { type: 'button', onclick: () => { store.set({ t: model.start, playing: false }); scroller.scrollTo({ top: 0 }); } }, 'Back to the start'));

  const chaptersSec = h('section.sec.sec-chapters', { 'aria-labelledby': 'h-chapters' },
    h('div.sec-head', h('h2.sec-title', { id: 'h-chapters' }, 'Chapters'), h('span.sec-aside.follow-only.scroll-cue', frag(ICONS.scroll), h('span', 'Scroll to see the story'))),
    steps, stepsEnd, chapterList);

  // ── Feed ────────────────────────────────────────────────────────────────────
  const feedList = h('div.feed-list', { role: 'list' });
  const feedCount = h('span.sec-aside');
  const feedEmpty = h('p.empty', 'Nothing has happened yet. Press play or drag the timeline.');
  const feedSec = h('section.sec.sec-feed', { 'aria-labelledby': 'h-feed' },
    h('div.sec-head', h('h2.sec-title', { id: 'h-feed' }, 'Event feed'), feedCount), feedEmpty, feedList);

  const scroller = h('div.panel-scroll', head, status, chaptersSec, feedSec,
    h('p.panel-credit', 'Map data © ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap contributors'), ' (ODbL).'));
  const handle = h('button.sheet-handle', { type: 'button', 'aria-label': 'Resize the story panel', title: 'Drag, or press to expand' }, h('span'));
  const el = h('aside.panel', { id: 'story-panel', 'aria-label': 'Story', tabindex: '-1' }, handle, scroller);
  root.append(el);
  // the cue pulses until the reader first scrolls the story
  // Only the reader's own wheel, touch or keys stop it: the panel also scrolls itself as the story plays.
  const stopCue = () => el.classList.add('has-scrolled');
  for (const ev of ['wheel', 'touchmove']) scroller.addEventListener(ev, stopCue, { once: true, passive: true });
  scroller.addEventListener('keydown', (e) => { if (['ArrowDown', 'PageDown', ' ', 'End'].includes(e.key)) stopCue(); });

  modeGroup.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  modeGroup.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
    ev.preventDefault();
    const next = store.get().mode === 'follow' ? 'explore' : 'follow';
    setMode(next);
    modeGroup.querySelector(`[data-mode="${next}"]`).focus();
  });
  function setMode(mode) {
    if (store.get().mode === mode) return;
    store.set({ mode });
    requestAnimationFrame(() => {
      if (mode === 'follow') syncScrollToTime(store.get().t, true);
      else scrollToExploreTop();
    });
  }
  // Land on the chapter list and feed, with the sticky status bar above them.
  function scrollToExploreTop() {
    suppressUntil = performance.now() + 200;
    scroller.scrollTop = Math.max(0, chaptersSec.offsetTop - status.offsetHeight - 28);
  }

  // ── Scrollytelling ──────────────────────────────────────────────────────────
  let suppressUntil = 0;
  let ownTop = null;
  let userScrollAt = 0;
  let lastScrollT = null;

  function timeFromScroll() {
    const line = scroller.scrollTop + scroller.clientHeight * READING_LINE;
    let active = null;
    for (const s of stepEls) if (s.li.offsetTop <= line) active = s;
    if (!active) return model.start;
    const p = clamp((line - active.li.offsetTop) / Math.max(1, active.li.offsetHeight), 0, 1);
    return active.c.start + p * (active.c.end - active.c.start);
  }

  function syncScrollToTime(t, force = false) {
    if (store.get().mode !== 'follow') return;
    if (!force && performance.now() - userScrollAt < 700) return;
    const s = stepEls.find((x) => t >= x.c.start && t < x.c.end) ?? stepEls.at(-1);
    const p = clamp((t - s.c.start) / Math.max(1, s.c.end - s.c.start), 0, 1);
    let target = s.li.offsetTop + p * s.li.offsetHeight - scroller.clientHeight * READING_LINE;
    if (t <= model.start + 0.01) target = 0;
    target = clamp(target, 0, scroller.scrollHeight - scroller.clientHeight);
    if (Math.abs(target - scroller.scrollTop) < 1) return;
    suppressUntil = performance.now() + 200;
    scroller.scrollTop = target;
    ownTop = scroller.scrollTop; // where we put it: a scroll event at this position is ours, not the reader's
  }

  scroller.addEventListener('scroll', rafThrottle(() => {
    if (store.get().mode !== 'follow') return;
    if (performance.now() < suppressUntil) return;
    // Slow frames can deliver our own scroll event after the time window: compare positions too,
    // or playback would pause itself and the next Pause click would start it again.
    if (ownTop != null && Math.abs(scroller.scrollTop - ownTop) < 2) return;
    ownTop = null;
    userScrollAt = performance.now();
    const t = timeFromScroll();
    lastScrollT = t;
    store.set({ t, playing: false });
  }), { passive: true });

  const setScrollHeight = () => el.style.setProperty('--scroll-h', `${scroller.clientHeight}px`);
  new ResizeObserver(setScrollHeight).observe(scroller);

  // ── Mobile bottom sheet ─────────────────────────────────────────────────────
  const sheet = createSheet({ el, handle, scroller, store });

  // ── Render ─────────────────────────────────────────────────────────────────
  let feedKey = '';
  let lastMode = null;
  function update(st, s) {
    el.dataset.mode = s.mode;
    if (lastMode && s.mode !== lastMode && s.mode === 'explore' && scroller.scrollTop > chaptersSec.offsetTop) scrollToExploreTop();
    lastMode = s.mode;
    timeChip.lastChild.textContent = fmtClock(st.t);
    summary.textContent = st.visible
      ? `${st.visible} event${st.visible === 1 ? '' : 's'} so far, ${st.confirmed} confirmed`
      : 'No events yet';
    for (const b of modeGroup.children) {
      const on = b.dataset.mode === s.mode;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    modeHint.textContent = s.mode === 'follow'
      ? 'Scrolling the chapters moves the clock and the camera.'
      : 'Move the map yourself and use the timeline below.';

    // Steps: reveal each chapter's events as their time arrives.
    stepEls.forEach((step, i) => {
      const active = i === st.chapterIndex;
      step.li.classList.toggle('is-active', active);
      step.li.classList.toggle('is-past', i < st.chapterIndex);
      step.li.style.setProperty('--p', active ? st.chapterProgress.toFixed(3) : i < st.chapterIndex ? '1' : '0');
      step.row.classList.toggle('is-active', active);
      step.row.style.setProperty('--p', active ? st.chapterProgress.toFixed(3) : i < st.chapterIndex ? '1' : '0');
      step.row.setAttribute('aria-current', active ? 'step' : 'false');
      let upcoming = 0;
      for (const id of step.c.events) {
        const e = model.byId.get(id);
        const es = st.ev.get(id);
        let card = step.cards.get(id);
        if (es.vis && !card) {
          card = eventCard(e, { onSelect: (eid) => onSelect(eid, 'card') });
          card.classList.add('is-new');
          step.cards.set(id, card);
          const after = [...step.cards.keys()].map((k) => model.byId.get(k)).sort((a, b) => a.start - b.start);
          const idx = after.findIndex((x) => x.id === id);
          const before = step.evWrap.children[idx];
          step.evWrap.insertBefore(card, before ?? null);
        } else if (!es.vis && card) {
          card.remove();
          step.cards.delete(id);
          card = null;
        }
        if (card) {
          card.classList.toggle('is-selected', s.selectedId === id);
          card.setAttribute('aria-pressed', String(s.selectedId === id));
        } else upcoming++;
      }
      step.li.querySelector('.step-upcoming').textContent = upcoming && i >= st.chapterIndex
        ? `${upcoming} more event${upcoming === 1 ? '' : 's'} in this chapter`
        : '';
    });

    // Feed: latest first.
    const visible = model.events.filter((e) => st.ev.get(e.id).vis).reverse();
    const key = visible.map((e) => e.id).join(',');
    if (key !== feedKey) {
      feedKey = key;
      feedList.replaceChildren(...visible.map((e) => {
        const card = eventCard(e, { onSelect: (eid) => onSelect(eid, 'feed') });
        card.setAttribute('role', 'listitem');
        return card;
      }));
    }
    feedEmpty.hidden = visible.length > 0;
    feedCount.textContent = `${visible.length} of ${model.events.length}`;
    for (const card of feedList.children) {
      const id = card.dataset.id;
      card.classList.toggle('is-selected', s.selectedId === id);
      card.setAttribute('aria-pressed', String(s.selectedId === id));
    }

    if (st.t !== lastScrollT) syncScrollToTime(st.t);
    sheet.update(s);
  }

  return {
    el,
    update,
    scroller,
    expand: () => sheet.snapTo('half'),
    syncScroll: () => syncScrollToTime(store.get().t, true),
  };
}

/** Bottom-sheet behaviour for small screens: peek, half and full snap points. */
function createSheet({ el, handle, scroller, store }) {
  const root = document.documentElement;
  let snap = 'peek';
  let height = 0;
  const heights = () => {
    const H = window.innerHeight;
    return { peek: Math.min(176, Math.round(H * 0.26)), half: Math.round(H * 0.54), full: H - 70 };
  };

  function apply(hgt, animate) {
    height = hgt;
    el.classList.toggle('is-dragging', !animate);
    el.style.setProperty('--sheet-h', `${hgt}px`);
    root.style.setProperty('--sheet-h', `${hgt}px`);
  }

  function snapTo(name, animate = true) {
    snap = name;
    apply(heights()[name], animate);
    el.dataset.snap = name;
    root.dataset.sheet = name;
    handle.setAttribute('aria-label', `Story panel ${name === 'peek' ? 'collapsed' : name === 'half' ? 'half open' : 'expanded'}. Press to ${name === 'full' ? 'collapse' : 'expand'}.`);
    if (store.get().sheetSnap !== name) store.set({ sheetSnap: name });
  }

  let drag = null;
  const start = (ev) => {
    if (!store.get().mobile) return;
    drag = { y: ev.clientY, h: height, t: performance.now(), moved: false };
    handle.setPointerCapture?.(ev.pointerId);
  };
  handle.addEventListener('pointerdown', start);
  handle.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dy = ev.clientY - drag.y;
    if (Math.abs(dy) > 4) drag.moved = true;
    const hs = heights();
    apply(clamp(drag.h - dy, hs.peek - 30, hs.full + 10), false);
  });
  const end = (ev) => {
    if (!drag) return;
    const dy = ev.clientY - drag.y;
    const v = dy / Math.max(1, performance.now() - drag.t); // px per ms, positive = down
    const hs = heights();
    let name;
    if (!drag.moved) name = snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek';
    else if (v < -0.6) name = height > hs.half ? 'full' : 'half';
    else if (v > 0.6) name = height < hs.half ? 'peek' : 'half';
    else name = Object.entries(hs).sort((a, b) => Math.abs(a[1] - height) - Math.abs(b[1] - height))[0][0];
    drag = null;
    snapTo(name);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowUp') { ev.preventDefault(); snapTo(snap === 'peek' ? 'half' : 'full'); }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); snapTo(snap === 'full' ? 'half' : 'peek'); }
  });

  let wasMobile = null;
  function update(s) {
    if (s.mobile !== wasMobile) {
      wasMobile = s.mobile;
      if (s.mobile) snapTo(s.sheetSnap ?? 'peek', false);
      else {
        root.style.removeProperty('--sheet-h');
        el.style.removeProperty('--sheet-h');
        delete root.dataset.sheet;
      }
    }
  }
  window.addEventListener('resize', () => { if (store.get().mobile) snapTo(snap, false); });
  scroller.addEventListener('focusin', () => { if (store.get().mobile && snap === 'peek') snapTo('half'); });

  return { update, snapTo };
}
