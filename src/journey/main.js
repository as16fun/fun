import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '../styles/journey.css';

import { h, frag, rafThrottle, debounce } from '../util/dom.js';
import { ICONS } from '../ui/icons.js';
import { clamp } from '../util/geo.js';
import { createJourneyMap } from './journeyMap.js';
import { isPlaceholder, contactTarget, contactAttrs } from '../util/contact.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileQuery = matchMedia('(max-width: 767px)'); // cards at the bottom, map above
const phoneQuery = matchMedia('(max-width: 767px)');
const root = document.documentElement;

const getJSON = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

boot().catch((err) => {
  console.error(err);
  document.querySelector('#boot p').textContent = `Could not load the map: ${err.message}`;
  root.classList.add('has-error');
});

async function boot() {
  root.classList.toggle('reduced-motion', reducedMotion);
  const [content, europe] = await Promise.all([getJSON('journey/journey.json'), getJSON('journey/europe.geojson')]);
  const chapters = content.chapters;
  const points = chapters.map((c) => c.place.point);
  const N = chapters.length;

  renderTopbar(content);
  const stepEls = renderStory(content);
  const progress = renderProgress(chapters, (i) => scrollToStep(i));

  // ── Map ─────────────────────────────────────────────────────────────────────
  const container = document.getElementById('map');
  const jm = createJourneyMap({ container, europe, start: content.intro.camera, reducedMotion });
  await jm.ready;
  jm.setRoute(points);
  jm.setReached(0);
  setPadding(0);

  const first = await loadCity(chapters[0].district);
  jm.addCity(chapters[0].id, first, { highlightIds: chapters[0].place.buildingIds ?? [] });
  root.classList.add('is-ready');
  // The other cities stream in while the reader is still in Macerata.
  const rest = Promise.all(chapters.slice(1).map(async (c) => {
    const d = await loadCity(c.district);
    jm.addCity(c.id, d, { highlightIds: c.place.buildingIds ?? [] });
  })).catch((err) => console.error('City data failed to load', err));
  void rest;

  window.__journey = { jm, chapters }; // handy for debugging in the console
  const overlay = createOverlay({ jm, chapters });
  jm.map.on('render', () => overlay.update(active));

  // ── Scroll drives the camera ────────────────────────────────────────────────
  let active = -1;
  let exploring = false;
  let introDone = false;

  function go(i) {
    if (i === active) return;
    const prev = active;
    active = i;
    progress.setActive(i);
    stepEls.forEach((el, k) => el.classList.toggle('is-active', k === i));
    if (exploring) setExplore(false, { fly: false });

    for (const [key, city] of jm.cities) if (key !== chapters[i]?.id) jm.setTint(city, 0);
    // Route: segments before the previous stop are drawn; the one being flown animates.
    const forward = prev === i - 1 && i >= 1;
    for (let j = 0; j < N - 1; j++) {
      if (i >= N) jm.setRouteProgress(j, 1);
      else if (j < i - 1 || (j === i - 1 && !forward)) jm.setRouteProgress(j, 1);
      else if (j >= i) jm.setRouteProgress(j, 0);
    }

    if (i < N) {
      const ch = chapters[i];
      if (!forward) jm.setReached(Math.min(i, N));
      jm.flyTo(cameraFor(ch), {
        duration: prev === -1 ? 3600 : 5600,
        padding: paddingFor(i),
        // between cities the camera pulls back to Europe first, then drops into the next city
        peakZoom: prev >= 0 && prev < N ? 5.3 : undefined,
        // the route is drawn while the camera drops in, not while it pulls back
        onFrame: forward && i > 0 ? (k, zoomIn = k) => jm.setRouteProgress(i - 1, clamp(zoomIn * 1.2, 0, 1)) : null,
        onDone: () => {
          const city = jm.cities.get(ch.id);
          if (city) jm.setTint(city, 1);
          jm.setReached(i + 1);
        },
      });
    } else {
      jm.setReached(N);
      // the closing view shows all of Italy (down to Sicily) and the Dutch coast, using the whole height of the screen
      const endPad = mobileQuery.matches ? paddingFor(i) : { ...paddingFor(i), top: 100, bottom: 80, right: 30 }; // beside the card, but using the full height
      jm.flyTo(jm.fitAll([...points, [14.9, 36.6], [4.8, 53.4]], mobileQuery.matches ? 12 : 20, mobileQuery.matches ? undefined : endPad), { duration: 4200, padding: endPad });
    }
  }

  const activeFromScroll = () => {
    const line = window.innerHeight * 0.55;
    let idx = 0;
    stepEls.forEach((el, k) => { if (el.getBoundingClientRect().top <= line) idx = k; });
    return idx;
  };
  const onScroll = rafThrottle(() => {
    if (window.scrollY > 40) root.classList.add('has-scrolled'); // the first button stops nudging
    progress.setFill(scrollFraction(stepEls));
    if (!introDone) return;
    go(activeFromScroll());
  });
  window.addEventListener('scroll', onScroll, { passive: true });

  function scrollToStep(i) {
    const el = stepEls[i];
    if (!el) return;
    const card = el.querySelector('.j-card');
    let top = el.getBoundingClientRect().top + window.scrollY + 2;
    if (mobileQuery.matches && card) {
      // on phones the cards sit at the bottom of their step: bring the card itself to the top, under the stops bar
      const bar = document.getElementById('progress')?.getBoundingClientRect().bottom ?? 120;
      top = card.getBoundingClientRect().top + window.scrollY - bar - 14;
    }
    window.scrollTo({ top: i === 0 ? 0 : top, behavior: reducedMotion ? 'auto' : 'smooth' });
    card?.focus({ preventScroll: true });
  }

  // ── Intro: Italy appears, then the camera dives into Macerata ──────────────
  await new Promise((r) => setTimeout(r, reducedMotion ? 0 : 900));
  // a link like index.html#stop-eindhoven opens on that stop, not on the first one
  const hashEl = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  const hashStep = hashEl ? stepEls.indexOf(hashEl.closest('.j-step')) : -1;
  if (hashStep > 0) window.scrollTo({ top: stepEls[hashStep].getBoundingClientRect().top + window.scrollY + 2, behavior: 'instant' });
  introDone = true;
  go(activeFromScroll());
  root.classList.add('is-intro-done');
  progress.setFill(scrollFraction(stepEls));

  // ── Explore mode: hand the camera to the reader ─────────────────────────────
  const controls = document.getElementById('controls');
  const exploreBtn = h('button.j-explore', { type: 'button', 'aria-pressed': 'false' }, frag(ICONS.compass), h('span', 'Explore the map'));
  const zoomIn = h('button.j-icon-btn', { type: 'button', 'aria-label': 'Zoom in', onclick: () => jm.map.easeTo({ zoom: jm.map.getZoom() + 0.8, duration: 300 }) }, frag(ICONS.plus));
  const zoomOut = h('button.j-icon-btn', { type: 'button', 'aria-label': 'Zoom out', onclick: () => jm.map.easeTo({ zoom: jm.map.getZoom() - 0.8, duration: 300 }) }, frag(ICONS.minus));
  const zoomGroup = h('div.j-zoom', { hidden: true }, zoomIn, zoomOut);
  controls.append(zoomGroup, exploreBtn);
  function setExplore(on, { fly = true } = {}) {
    exploring = on;
    root.classList.toggle('is-exploring', on);
    jm.setInteractive(on);
    container.setAttribute('aria-hidden', String(!on));
    exploreBtn.setAttribute('aria-pressed', String(on));
    exploreBtn.lastChild.textContent = on ? 'Back to the story' : 'Explore the map';
    exploreBtn.replaceChild(frag(on ? ICONS.close : ICONS.compass), exploreBtn.firstChild);
    zoomGroup.hidden = !on;
    if (!on && fly && active >= 0) {
      const ch = chapters[active];
      jm.flyTo(ch ? cameraFor(ch) : jm.fitAll(points, 120), { duration: 2600 });
    }
  }
  exploreBtn.addEventListener('click', () => setExplore(!exploring));
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && exploring) setExplore(false); });

  // In-page links (Next, Case studies, Contact) glide to their stop instead of jumping.
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href^="#"]:not(.skip-link)');
    const target = a && document.getElementById(a.getAttribute('href').slice(1));
    const i = target ? stepEls.indexOf(target.closest('.j-step')) : -1;
    if (i < 0) return;
    ev.preventDefault();
    scrollToStep(i);
    history.replaceState(null, '', a.getAttribute('href'));
  });

  // Phones see less around the subject, so they get a wider view, and wider still when a tall
  // card leaves only a thin strip of map above it.
  function cameraFor(ch) {
    if (!mobileQuery.matches) return ch.camera;
    const pad = paddingFor(chapters.indexOf(ch));
    const strip = window.innerHeight - pad.top - pad.bottom;
    const zoom = ch.camera.zoom + (phoneQuery.matches ? -0.7 : 0) + Math.log2(clamp(strip / 340, 0.45, 1));
    return { ...ch.camera, zoom };
  }

  // The map centres its subject in the space the story leaves free: beside the column on
  // desktop, above the card on phones and tablets (a tall card pushes the centre up).
  function paddingFor(i) {
    if (!mobileQuery.matches) {
      const story = document.getElementById('story').getBoundingClientRect();
      return { top: 80, bottom: 110, left: Math.round(Math.min(story.right, window.innerWidth * 0.45)), right: 40 };
    }
    const H = window.innerHeight;
    const card = stepEls[i]?.querySelector('.j-card');
    const covered = card ? card.offsetHeight + 56 : 0;
    return { top: 150, bottom: Math.round(clamp(covered, H * 0.42, H - 270)), left: 0, right: 0 };
  }
  function setPadding(i) { jm.map.setPadding(paddingFor(i)); }
  window.addEventListener('resize', debounce(() => {
    setPadding(Math.max(active, 0));
    const ch = chapters[active];
    if (ch && !exploring) jm.map.jumpTo(cameraFor(ch));
  }, 150));
}

async function loadCity(dir) {
  const files = ['meta.json', 'buildings.geojson', 'roads.geojson', 'rail.geojson', 'water.geojson', 'green.geojson', 'trees.geojson'];
  const [meta, buildings, roads, rail, water, green, trees] = await Promise.all(files.map((f) => getJSON(`${dir}/${f}`)));
  return { base: dir, meta, buildings, roads, rail, water, green, trees };
}

// ── Rendering ─────────────────────────────────────────────────────────────────
/** Text in [square brackets] is a placeholder: render it so it can't be missed. */
/** "Title (detail)" renders as two lines: the title, then the detail in regular weight. */
function roleParts(role) {
  const m = /^(.*?)\s*(\(.*\))$/.exec(role);
  return m ? [m[1], h('br'), h('span.j-role-sub', m[2])] : [withPlaceholders(role)];
}

function withPlaceholders(text) {
  const parts = String(text ?? '').split(/(\[[^\]]+\])/g).filter(Boolean);
  return parts.map((p) => (/^\[.*\]$/.test(p) ? h('span.ph', { title: 'Placeholder — edit public/journey/journey.json' }, p.slice(1, -1)) : p));
}
const placeIcon = (c) => ICONS[c.place.icon] ?? ICONS.target;
/** Arrows in a stat ("1 → 5") get their own span, so they can stay black between blue numbers. */
const withArrows = (v) => String(v).split(/(→|\n)/).filter(Boolean).map((p) => (p === '→' ? h('span.j-arrow', p) : p === '\n' ? h('br') : p));

function renderTopbar(content) {
  const p = content.person;
  const contact = contactTarget(p);
  const withCases = content.chapters.find((c) => c.caseStudies?.items?.length);
  document.getElementById('topbar').append(
    h('a.j-brand', { href: './' }, h('span.j-brand-mark', { html: LOGO }), h('span.j-brand-name', withPlaceholders(p.name))),
    h('nav.j-nav', { 'aria-label': 'Site' },
      withCases ? h('a', { href: 'case-studies/' }, 'Case studies') : null,
      h('a.j-nav-cta', contactAttrs(contact), 'Contact', contact?.external ? frag(ICONS.arrowUpRight) : null)));
}

function renderStory(content) {
  const story = document.getElementById('story');
  const p = content.person;
  const chapters = content.chapters;
  const hero = h('header.j-hero',
    h('p.j-eyebrow', 'Design journey'),
    h('h1.j-name', ...p.name.split(' ').flatMap((w, i) => (i ? [h('br'), w] : [w]))),
    h('p.j-role', ...roleParts(p.role)));

  const steps = chapters.map((c, i) => {
    const next = chapters[i + 1];
    const progression = c.roles?.length > 1 && i > 0;
    const nextLabel = next ? `Next: ${next.city}` : 'Whole route';
    const card = h('article.j-card.has-next', { tabindex: '-1', 'aria-labelledby': `t-${c.id}` },
      i === 0 ? hero : null,
      h('p.j-kicker', h('span.j-num', String(i + 1)), h('span', `${c.city}, ${c.country}`),
        h('span.j-count', `${String(i + 1).padStart(2, '0')} / ${String(chapters.length).padStart(2, '0')}`)),
      h('div.j-quote',
        h('h2.j-title', { id: `t-${c.id}` }, ...c.title.split('\n').flatMap((l, k) => (k ? [h('br'), l] : [l]))),
        h('p.j-text', withPlaceholders(c.text)),
        // the tag lives in the stops bar; a period, once filled in, shows here
        c.period && !isPlaceholder(c.period) ? h('p.j-tags', h('span.j-period', c.period)) : null),
      c.roles?.length
        ? h(`ol.j-roles${progression ? '.is-progression' : ''}`, { 'aria-label': progression ? 'Role progression' : 'Roles' },
          c.roles.map((r) => h('li', r)))
        : null,
      // Numbers ("20", "4", "1 → 5") are the headline of their tile: bigger, in blue.
      c.stats?.length ? h('dl.j-stats', c.stats.map((s) => h(`div.j-stat${/\d/.test(s.value) && String(s.value).length <= 6 ? '.is-number' : ''}`, h('dt', s.label), h('dd', withArrows(s.value))))) : null,
      h('div.j-card-foot'), // room for the round "next" button in the corner
      // The round button sits in a notch cut from the card's corner; it carries the "next" label.
      h(`a.j-next${i === 0 ? '.is-nudge' : ''}`, { href: next ? `#stop-${next.id}` : '#stop-outro', 'aria-label': nextLabel, title: nextLabel }, frag(ICONS.arrowDown)));
    // case studies are their own card under the stop's card, 16px apart
    return h('section.j-step', { id: `stop-${c.id}`, dataset: { i } },
      c.caseStudies?.items?.length ? h('div.j-stack', card, caseStudies(c)) : card);
  });

  const o = content.outro;
  const cta = isPlaceholder(o.cta.url) ? contactTarget(p) : { href: o.cta.url, external: /^https?:/.test(o.cta.url) };
  const links = (p.links ?? []).filter((l) => l.url !== cta?.href);
  const outro = h('section.j-step.j-outro', { id: 'stop-outro', dataset: { i: chapters.length } },
    h('article.j-card', { tabindex: '-1', id: 'contact', 'aria-labelledby': 't-outro' },
      h('p.j-kicker.is-route', h('span', o.route ?? chapters.map((c) => c.city).join(' → '))),
      h('h2.j-title', { id: 't-outro' }, o.title),
      h('p.j-text', withPlaceholders(o.text)),
      h('div.j-actions',
        h('a.j-btn.primary', cta ? contactAttrs(cta) : { href: '#contact', 'aria-disabled': 'true', title: 'Add your email in public/journey/journey.json' },
          o.cta.label, cta?.external ? frag(ICONS.arrowUpRight) : null),
        o.secondary ? h('a.j-btn', { href: o.secondary.url }, o.secondary.label) : null),
      links.length
        ? h('p.j-links', links.map((l) => (isPlaceholder(l.url)
          ? h('span.ph', { title: 'Placeholder — edit public/journey/journey.json' }, l.label)
          : h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label, frag(ICONS.external)))))
        : null));

  story.append(...steps, outro);
  return [...steps, outro];
}

/** Case studies attached to a stop. Without a `url` yet, an item shows as "coming soon". */
function caseStudies(c) {
  const { title, items } = c.caseStudies;
  return h('section.j-cases', { 'aria-labelledby': `cases-${c.id}` },
    h('h3.j-cases-title', { id: `cases-${c.id}` }, h('span', title ?? 'Case studies'), h('span.j-cases-count', String(items.length).padStart(2, '0'))),
    h('ol.j-cases-list', items.map((cs) => {
      const ready = cs.url && !isPlaceholder(cs.url);
      // The title link stretches over the whole row, so the row is one big target.
      return h(`li.j-case${ready ? '.is-ready' : ''}`,
        h('div.j-case-body',
          h('p.j-case-top', ready ? h('a.j-case-title', { href: cs.url }, withPlaceholders(cs.title)) : h('span.j-case-title', withPlaceholders(cs.title))),
          h('p.j-case-meta',
            cs.year ? h('span.j-case-year', cs.year) : null,
            ready ? h('span.j-case-read', 'Read the case study') : h('span.j-case-soon', 'Case study coming soon'))),
        ready ? h('span.j-case-go', { 'aria-hidden': 'true' }, frag(ICONS.arrowUpRight)) : null);
    })));
}

function renderProgress(chapters, onJump) {
  const nav = document.getElementById('progress');
  const N = chapters.length;
  const fills = [];
  const stops = chapters.map((c, i) => h('button.j-stop', { type: 'button', dataset: { i }, onclick: () => onJump(i) },
    h('span.j-stop-dot', String(i + 1)),
    h('span.j-stop-text', h('b', c.city), h('small', c.tag))));
  // One line per leg of the route, with the same gap to the text before it and the number after it.
  nav.append(h('ol', stops.map((b, i) => {
    if (i === N - 1) return h('li', b);
    const fill = h('i');
    fills.push(fill);
    return h('li', b, h('span.j-leg', { 'aria-hidden': 'true' }, fill));
  })));
  return {
    setActive(i) {
      stops.forEach((b, k) => {
        b.classList.toggle('is-active', k === i);
        b.classList.toggle('is-done', k < i);
        if (k === i) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
      });
    },
    setFill(f) { fills.forEach((el, j) => { el.style.transform = `scaleX(${clamp(f * (N - 1) - j, 0, 1).toFixed(3)})`; }); },
  };
}

/** 0 at the first stop, 1 at the last city stop. */
function scrollFraction(stepEls) {
  const line = window.innerHeight * 0.55;
  const tops = stepEls.slice(0, -1).map((el) => el.getBoundingClientRect().top + window.scrollY);
  const y = window.scrollY + line;
  if (y <= tops[0]) return 0;
  for (let i = 0; i < tops.length - 1; i++) {
    if (y < tops[i + 1]) return (i + (y - tops[i]) / (tops[i + 1] - tops[i])) / (tops.length - 1);
  }
  return 1;
}

// ── Overlay: city labels at Europe scale, place markers on the rooftops ────────
function createOverlay({ jm, chapters }) {
  const layer = document.getElementById('overlay');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'j-outline');
  layer.append(svg);
  const labels = chapters.map((c, i) => {
    const el = h('div.j-city', h('span.j-city-n', String(i + 1)), h('span.j-city-name', c.city), h('span.j-city-country', c.country));
    layer.append(el);
    return el;
  });
  const markers = chapters.map((c) => {
    const el = h(`div.j-marker${c.place.marker === 'city' ? '.is-city' : ''}`,
      h('div.j-marker-card',
        h('span.j-marker-icon', frag(placeIcon(c))),
        h('span.j-marker-text', h('strong', c.place.name), h('small', c.place.sub))),
      h('span.j-marker-stem'));
    layer.append(el);
    return el;
  });

  const fade = (z, a, b) => clamp((z - a) / (b - a), 0, 1);
  return {
    update(active) {
      const z = jm.map.getZoom();
      const labelAlpha = 1 - fade(z, 8.6, 9.8);
      const placed = [];
      chapters.forEach((c, i) => {
        const p = jm.map.project(c.place.point);
        const el = labels[i];
        const w = el.offsetWidth || 140;
        const maxX = window.innerWidth - 8 - w;
        const free = ({ x, y }) => x >= 8 && x <= maxX && !placed.some((q) => Math.abs(q.y - y) < 30 && x < q.x1 + 6 && x + w > q.x0 - 6);
        const right = p.x + 14, left = p.x - 14 - w;
        const spot = [{ x: right, y: p.y }, { x: left, y: p.y }, { x: right, y: p.y - 30 }, { x: left, y: p.y - 30 }, { x: right, y: p.y + 30 }]
          .find(free) ?? { x: clamp(right, 8, Math.max(8, maxX)), y: p.y };
        placed.push({ x0: spot.x, x1: spot.x + w, y: spot.y });
        el.style.opacity = labelAlpha.toFixed(3);
        el.style.visibility = labelAlpha > 0.01 ? 'visible' : 'hidden';
        el.style.transform = `translate3d(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px, 0)`;
        el.classList.toggle('is-active', i === active);

        const city = jm.cities.get(c.id);
        // City-level stops float a badge high above the district instead of pinning a spot.
        const isCity = c.place.marker === 'city';
        const roof = isCity ? 220 : city?.highlight[0]?.h ? city.highlight[0].h * 1.06 + 3 : 0;
        const m = markers[i];
        const markerAlpha = i === active ? fade(z, isCity ? 13.6 : 14.2, isCity ? 14.4 : 15) : 0;
        m.style.opacity = markerAlpha.toFixed(3);
        m.style.visibility = markerAlpha > 0.01 ? 'visible' : 'hidden';
        if (markerAlpha > 0.01) {
          const q = jm.screenAt(c.place.point, roof);
          m.style.transform = `translate3d(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px, 0)`;
          // keep the label card on screen; the stem still points at the real spot
          const card = m.firstChild;
          const half = (card.offsetWidth || 220) / 2;
          const dx = clamp(q.x, half + 10, window.innerWidth - half - 10) - q.x;
          card.style.setProperty('--dx', `${dx.toFixed(1)}px`);
        }
      });

      // Glowing outline around the highlighted building of the current stop.
      svg.replaceChildren();
      const city = active >= 0 && active < chapters.length ? jm.cities.get(chapters[active].id) : null;
      if (!city || city.tint < 0.3 || z < 14.5) return;
      for (const b of city.highlight) {
        const top = b.ring.map((ll) => jm.screenAt(ll, b.h * (1 + 0.06 * city.tint)));
        const base = b.ring.map((ll) => jm.screenAt(ll, 0));
        let d = `M${top.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`;
        for (let k = 0; k < top.length; k += Math.max(1, Math.floor(top.length / 10))) d += `M${top[k].x.toFixed(1)},${top[k].y.toFixed(1)}L${base[k].x.toFixed(1)},${base[k].y.toFixed(1)}`;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.style.opacity = city.tint.toFixed(2);
        svg.append(path);
      }
    },
  };
}

const LOGO = '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="16" fill="#0E1220"/><g transform="translate(16 15.5) scale(0.7) translate(-16.4 -15.5)"><path d="M27.9707 25.2833L18.1852 3.97022L18.1755 3.95166C18.0114 3.61519 17.7561 3.33154 17.4388 3.13298C17.1214 2.93441 16.7547 2.82889 16.3804 2.82843C16.006 2.82797 15.6391 2.93258 15.3212 3.13037C15.0034 3.32816 14.7475 3.61118 14.5825 3.94724C14.5788 3.95314 14.5755 3.95935 14.5728 3.9658L4.79174 25.2833C4.60923 25.6553 4.54858 26.0753 4.61839 26.4837C4.68821 26.8921 4.88494 27.2682 5.18065 27.5584L5.20716 27.5849C5.5082 27.8814 5.89654 28.0733 6.31492 28.1324C6.73329 28.1914 7.15957 28.1145 7.53089 27.9129L7.55388 27.9005L16.3786 22.9366L25.2033 27.9005L25.2262 27.9129C25.5981 28.1097 26.0225 28.1843 26.4392 28.126C26.8559 28.0676 27.2435 27.8794 27.547 27.588C27.8506 27.2967 28.0544 26.917 28.1297 26.5031C28.205 26.0891 28.1478 25.662 27.9663 25.2824L27.9707 25.2833ZM16.8709 20.9169C16.7214 20.8329 16.5527 20.7888 16.3812 20.7888C16.2097 20.7888 16.0411 20.8329 15.8915 20.9169L6.59663 26.146L6.60635 26.1256L16.3812 4.81786L26.157 26.123L26.1658 26.1424L16.8709 20.9169Z" fill="#fff" stroke="#fff" stroke-width="0.75" stroke-linejoin="round"/></g></svg>';
