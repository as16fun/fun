import '@fontsource-variable/inter';
import './styles/main.css';
import './styles/ui.css';

import { createStore } from './util/store.js';
import { makeLocal, circleRing, ringCentroid } from './util/geo.js';
import { h, frag, debounce, copyText } from './util/dom.js';
import { fmtClock, parseStoryTime } from './util/time.js';
import { buildModel } from './story/model.js';
import { computeState, neighbourEvent } from './story/state.js';
import { createMap } from './map/createMap.js';
import { treeSolids } from './map/style.js';
import { createStoryLayers } from './map/storyLayers.js';
import { createOverlay } from './ui/overlay.js';
import { createTimeline } from './ui/timeline.js';
import { createPanel } from './ui/panel.js';
import { createDetail } from './ui/detail.js';
import { createLayersPanel } from './ui/layersPanel.js';
import { createMapControls } from './ui/mapControls.js';
import { createTopbar } from './ui/topbar.js';
import { createDialogs } from './ui/dialogs.js';
import { ICONS } from './ui/icons.js';
import { BREAKPOINT, CONFIDENCE, PLAYBACK } from './config.js';

const params = new URLSearchParams(location.search);
const EMBED = params.get('embed') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileQuery = matchMedia(`(max-width: ${BREAKPOINT - 1}px)`);

const getJSON = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

boot().catch((err) => {
  console.error(err);
  document.getElementById('boot-status')?.replaceChildren(`Could not load the story: ${err.message}`);
  document.documentElement.classList.add('has-error');
});

async function boot() {
  const root = document.documentElement;
  root.classList.toggle('is-embed', EMBED);
  root.classList.toggle('reduced-motion', reducedMotion);

  const [meta, story, buildingsFC, roads, rail, water, green, trees] = await Promise.all([
    getJSON('data/meta.json'),
    getJSON('data/story.json'),
    ...['buildings', 'roads', 'rail', 'water', 'green', 'trees'].map((n) => getJSON(`data/${n}.geojson`)),
  ]);

  const local = makeLocal(meta.origin);
  const buildings = indexBuildings(buildingsFC, local);
  const model = buildModel(story, { toXY: local.toXY, buildings });
  const eventBuildingIds = [...new Set(model.events.flatMap((e) => e.buildingIds))];
  document.title = `${model.story.title} · Storyline (fictional demo)`;

  // ── Map ─────────────────────────────────────────────────────────────────────
  const api = createMap({
    container: document.getElementById('map'),
    meta,
    data: { buildings: buildingsFC, roads, rail, water, green, treeSolids: treeSolids(trees, local, circleRing, local.toXY(meta.focus)) },
    eventBuildingIds,
    reducedMotion,
    // Inside an article, page scrolling must win: zooming needs Ctrl/⌘ + scroll, panning two fingers.
    cooperativeGestures: EMBED,
  });
  const storyLayers = createStoryLayers({ api, model, local, buildings, reducedMotion, lat: meta.origin[1] });

  // ── State ───────────────────────────────────────────────────────────────────
  const fromHash = readHash(model);
  const store = createStore({
    t: fromHash.t ?? model.start,
    playing: false,
    speed: PLAYBACK.speeds[0],
    selectedId: null,
    hoverId: null,
    free: false, // true while the reader navigates the map by hand (the "Explore the map" button)
    mode: 'follow', // the camera follows the story's chapters, in the embed too
    layers: { events: true, movement: true, crowd: true, closures: true, buildings: true },
    mobile: mobileQuery.matches,
    sheetSnap: 'peek',
    introDone: false,
  });
  window.__dispatch = { store, model, api }; // handy for debugging in the console

  // ── UI ──────────────────────────────────────────────────────────────────────
  const ui = document.getElementById('ui');
  const announcer = document.getElementById('announcer');
  const announce = (text) => { announcer.textContent = ''; setTimeout(() => { announcer.textContent = text; }, 30); };

  const actions = {
    selectEvent: (id) => select(id, 'search'),
    focusStreet: (name, bbox) => {
      api.focusBounds(bbox, { minZoom: 16.4, maxZoom: 17.6 });
      api.highlightStreet(name);
      announce(`Showing ${name}`);
    },
    showSource: (id) => {
      if (store.get().mobile) store.set({ sheetSnap: 'full' });
      panel?.expand();
      requestAnimationFrame(() => {
        const item = document.getElementById(`source-${id}`);
        item?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
        item?.classList.add('is-flash');
        setTimeout(() => item?.classList.remove('is-flash'), 1800);
      });
    },
    openSearch: () => topbar?.focusSearch(),
    openShortcuts: () => dialogs.shortcuts(),
    openAbout: () => dialogs.about(),
    replayIntro: async () => {
      root.classList.remove('is-intro-done');
      await api.runIntro({ replay: true });
      root.classList.add('is-intro-done');
    },
    resetView: () => api.resetView(),
  };

  const overlay = createOverlay({
    root: document.getElementById('overlay'),
    api, model, buildings, storyLayers,
    onSelect: (id, origin) => select(id, origin),
    onHover: (id) => store.set({ hoverId: id }),
  });
  const topbar = EMBED ? null : createTopbar({ root: ui, model, store, roads, actions });
  const panel = EMBED ? null : createPanel({
    root: ui, model, store,
    onSelect: (id, origin) => select(id, origin),
    onChapter: (c) => jumpToChapter(c),
  });
  const embedCard = EMBED ? createEmbedCard(ui, model, store) : null;
  const detail = createDetail({
    root: ui, model, store,
    onSelect: (id, origin) => select(id, origin),
    onClose: () => store.set({ selectedId: null }),
    onJump: (e) => store.set({ t: e.start, playing: false }),
    onCopyLink: (e) => copyText(topbar ? topbar.linkFor(e) : location.href),
  });
  const layersPanel = createLayersPanel({ root: ui, store });
  const controls = createMapControls({ root: ui, api });
  const timeline = createTimeline({
    root: ui, model, store,
    onSelect: (id, origin) => select(id, origin),
  });
  const dialogs = createDialogs({ root: document.body, model });
  const views = [timeline, panel, detail, layersPanel, controls, topbar, embedCard].filter(Boolean);

  // ── Selection & camera ──────────────────────────────────────────────────────
  function select(id, origin = 'ui') {
    const e = id ? model.byId.get(id) : null;
    if (!e) {
      store.set({ selectedId: null });
      return;
    }
    const s = store.get();
    const patch = { selectedId: e.id };
    if (s.t < e.start) patch.t = e.start; // make sure the event exists at the current moment
    if (s.mobile && origin !== 'detail') patch.sheetSnap = 'peek';
    store.set(patch); // renders the detail card synchronously
    updatePadding('next'); // …so the glide can land the event in the space beside it
    focusEvent(e);
    announce(`Event ${e.n}: ${e.title}. ${CONFIDENCE[e.confidence].label}.`);
  }

  function focusEvent(e) {
    const g = e.geom;
    // Areas and routes are framed whole; single spots get a close, angle-preserving glide.
    if (g.ring || g.lines) api.focusBounds(g.bbox, { minZoom: 16.4, maxZoom: 17.6 });
    else api.focusPoint(g.anchor, 17.3);
  }

  function jumpToChapter(c) {
    store.set({ t: c.start, playing: false });
    api.focusChapter(c);
    panel?.syncScroll();
  }

  // ── Apply state → map + UI ──────────────────────────────────────────────────
  let layersApplied = null;
  let installed = false;
  let lastChapter = -1;
  let lastVisible = null;
  const apply = (s, prev) => {
    if (!installed) return;
    const st = computeState(model, s.t);
    if (s.layers !== layersApplied) {
      storyLayers.setLayers(s.layers);
      layersApplied = s.layers;
    }
    const hoverEvent = s.hoverId ? model.byId.get(s.hoverId) : null;
    storyLayers.setHover(hoverEvent?.buildingIds[0] ?? null);
    storyLayers.update(st);
    overlay.update(st, s);
    for (const v of views) v.update(st, s);

    // Follow mode: the camera follows the chapter that the clock is in.
    if (st.chapterIndex !== lastChapter) {
      lastChapter = st.chapterIndex;
      if (s.mode === 'follow' && !s.free && s.introDone) api.focusChapter(model.chapters[st.chapterIndex]);
    }
    if (prev && s.mode === 'follow' && prev.mode !== 'follow' && !s.free && s.introDone) api.focusChapter(model.chapters[st.chapterIndex]);
    if (prev && prev.free && !s.free && s.introDone) api.focusChapter(model.chapters[st.chapterIndex]);

    // Announce new events while playing (not while scrubbing through many at once).
    if (lastVisible && s.playing) {
      const fresh = model.events.filter((e) => st.ev.get(e.id).vis && !lastVisible.has(e.id));
      if (fresh.length === 1) announce(`${fmtClock(fresh[0].start)}. Event ${fresh[0].n}: ${fresh[0].title}.`);
      else if (fresh.length > 1) announce(`${fresh.length} new events up to ${fmtClock(st.t)}.`);
    }
    lastVisible = new Set(model.events.filter((e) => st.ev.get(e.id).vis).map((e) => e.id));
  };
  const relevant = ['free', 't', 'playing', 'speed', 'selectedId', 'hoverId', 'layers', 'mode', 'mobile', 'introDone', 'sheetSnap'];
  store.subscribe((s, prev) => {
    if (relevant.some((k) => s[k] !== prev[k])) apply(s, prev);
    if ((!s.selectedId && prev.selectedId) || s.mobile !== prev.mobile || s.sheetSnap !== prev.sheetSnap) requestAnimationFrame(() => updatePadding());
  });

  // ── Playback loop ───────────────────────────────────────────────────────────
  let lastFrame = null;
  const tick = (now) => {
    const s = store.get();
    if (s.playing && lastFrame != null) {
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      const t = s.t + dt * s.speed * PLAYBACK.minutesPerSecond;
      if (t >= model.end) store.set({ t: model.end, playing: false });
      else store.set({ t });
    }
    lastFrame = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  api.setDriftAllowed(() => !store.get().playing && !store.get().selectedId);

  // ── Map picking & manual camera moves ───────────────────────────────────────
  const eventForBuilding = (bid) => {
    const { t } = store.get();
    return [...model.events].reverse().find((e) => e.buildingIds.includes(bid) && t >= e.start) ?? null;
  };
  api.on('hover', (bid) => {
    const e = bid ? eventForBuilding(bid) : null;
    api.map.getCanvas().style.cursor = e ? 'pointer' : '';
    if ((e?.id ?? null) !== store.get().hoverId) store.set({ hoverId: e?.id ?? null });
  });
  api.on('click', (bid) => {
    const e = bid ? eventForBuilding(bid) : null;
    if (e) select(e.id, 'building');
  });
  // ── Explore the map: by default the page belongs to the story ───────────────
  // A wheel turn anywhere over the map scrolls the story; the button hands the map to the reader.
  if (!EMBED && panel) {
    const exploreBtn = h('button.explore-btn', { type: 'button', 'aria-pressed': 'false' },
      frag(ICONS.compass), h('span', 'Explore the map'));
    ui.append(exploreBtn);
    const placeExplore = () => {
      const l = document.querySelector('.layers');
      if (!l) return;
      exploreBtn.style.right = `${ui.clientWidth - l.offsetLeft + 8}px`;
    };
    placeExplore();
    new ResizeObserver(placeExplore).observe(ui);
    const layersEl = document.querySelector('.layers');
    if (layersEl) new ResizeObserver(placeExplore).observe(layersEl);
    exploreBtn.addEventListener('click', () => store.set({ free: !store.get().free }));
    store.subscribe((s) => {
      api.setFreeNavigation(s.free);
      exploreBtn.setAttribute('aria-pressed', String(s.free));
      exploreBtn.classList.toggle('is-on', s.free);
      exploreBtn.lastChild.textContent = s.free ? 'Back to the story' : 'Explore the map';
      document.documentElement.classList.toggle('is-free', s.free);
    });
    window.addEventListener('wheel', (ev) => {
      if (store.get().free || ev.ctrlKey) return;
      if (!ev.target.closest?.('#map, #overlay')) return;
      ev.preventDefault();
      panel.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: ev.deltaY }));
      panel.scroller.scrollBy({ top: ev.deltaY });
    }, { passive: false });
  }

  // The story panel always follows the story: scrolling moves the clock and the camera, and panning
  // the map doesn't switch modes (there is no Explore toggle any more).

  // ── Map padding keeps the focus point in the free area between panels ──────
  // Desktop chrome is measured by its layout box, not getBoundingClientRect: it slides in during the
  // intro, and the free area must match where it lands, not where it is mid-animation.
  const frame = (el) => ({ top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight, right: el.offsetLeft + el.offsetWidth });
  function updatePadding(mode = store.get().introDone ? 'animate' : 'instant') {
    const s = store.get();
    const vh = window.innerHeight;
    let pad;
    if (s.mobile) {
      // On phones the timeline rides on the bottom sheet, which animates its height: use the
      // sheet's target height (--sheet-h), not the timeline's current position.
      const sheetH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h')) || 176;
      pad = { top: 64, bottom: Math.max(120, sheetH + 8 + timeline.el.offsetHeight + 10), left: 8, right: 8 };
    } else {
      const head = topbar?.el ?? embedCard?.el;
      const top = head ? frame(head).bottom : 0;
      let left = panel ? frame(panel.el).right + 12 : 16;
      if (s.selectedId && !detail.el.hidden) left = Math.max(left, frame(detail.el).right + 12);
      pad = { top: top + 12, bottom: vh - frame(timeline.el).top + 12, left, right: 24 };
    }
    overlay.setFreeArea(pad);
    api.setPadding(pad, mode);
  }
  window.addEventListener('resize', debounce(() => updatePadding('instant'), 120));
  mobileQuery.addEventListener('change', () => store.set({ mobile: mobileQuery.matches }));

  // ── Deep links: #t=19:42&event=e5 ──────────────────────────────────────────
  const writeHash = debounce((s) => {
    const parts = [`t=${fmtClock(s.t)}`];
    if (s.selectedId) parts.push(`event=${s.selectedId}`);
    const next = `#${parts.join('&')}`;
    if (location.hash !== next) history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
  }, 250);
  store.subscribe((s, prev) => {
    if (s.introDone && (s.t !== prev.t || s.selectedId !== prev.selectedId)) writeHash(s);
  });
  window.addEventListener('hashchange', () => {
    const hsh = readHash(model);
    store.set({ ...(hsh.t != null ? { t: hsh.t } : {}), playing: false });
    if (hsh.event) select(hsh.event, 'hash');
  });

  // ── Keyboard ────────────────────────────────────────────────────────────────
  window.addEventListener('keydown', (ev) => {
    const target = ev.target;
    const tag = target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey || dialogs.isOpen()) return;
    const role = target?.getAttribute?.('role');
    if (ev.key === ' ' && !['BUTTON', 'A'].includes(tag) && role !== 'slider') {
      ev.preventDefault();
      timeline.togglePlay();
    } else if ((ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && !['slider', 'radio', 'switch', 'menuitem'].includes(role)) {
      const next = neighbourEvent(model, store.get().t, ev.key === 'ArrowRight' ? 1 : -1);
      if (next) {
        ev.preventDefault();
        store.set({ t: next.start, playing: false });
        select(next.id, 'keyboard');
      }
    } else if (ev.key === 'Escape' && store.get().selectedId) {
      store.set({ selectedId: null });
    }
  });

  // ── Go ──────────────────────────────────────────────────────────────────────
  await api.ready;
  storyLayers.install();
  installed = true;
  apply(store.get());
  updatePadding();
  root.classList.add('is-ready');
  await api.runIntro();
  root.classList.add('is-intro-done');
  store.set({ introDone: true });
  updatePadding();
  if (fromHash.event) select(fromHash.event, 'hash');
  else if (store.get().mode === 'follow') {
    api.focusChapter(model.chapters[computeState(model, store.get().t).chapterIndex]);
    panel?.syncScroll();
  }
}

/** OSM building id → footprint rings (lon/lat), height, feature ids and a roof anchor. */
function indexBuildings(fc, local) {
  const index = new Map();
  for (const f of fc.features) {
    const { id, fid, h: height } = f.properties;
    const ring = f.geometry.coordinates[0].slice(0, -1);
    const area = Math.abs(f.properties.area ?? 0);
    let b = index.get(id);
    if (!b) {
      b = { fids: [], rings: [], h: 0, lonlat: null, bestArea: -1 };
      index.set(id, b);
    }
    b.fids.push(fid);
    b.rings.push(ring);
    b.h = Math.max(b.h, height);
    if (area > b.bestArea) {
      b.bestArea = area;
      b.lonlat = local.toLL(ringCentroid(ring.map(local.toXY)));
    }
  }
  return index;
}

function readHash(model) {
  const p = new URLSearchParams(location.hash.slice(1));
  const out = { t: null, event: null };
  const t = p.get('t');
  if (t && /^\d{1,2}:\d{2}$/.test(t)) {
    const m = parseStoryTime(t, model.story);
    if (m >= model.start && m <= model.end) out.t = m;
  }
  const ev = p.get('event');
  if (ev && model.byId.has(ev)) out.event = ev;
  return out;
}

/** Embed mode: a compact headline instead of the top bar and story panel. */
function createEmbedCard(root, model) {
  const full = new URL(location.href);
  full.searchParams.delete('embed');
  const el = h('header.embed-card',
    h('h1.embed-title', model.story.title),
    h('p.embed-meta', h('span.embed-status'), h('a', { href: full.toString(), target: '_blank', rel: 'noopener' }, 'Open the full story', frag(ICONS.external))));
  root.append(el);
  const status = el.querySelector('.embed-status');
  return {
    el,
    update(st) {
      status.textContent = `${fmtClock(st.t)} · ${st.visible} event${st.visible === 1 ? '' : 's'}, ${st.confirmed} confirmed · `;
    },
  };
}
