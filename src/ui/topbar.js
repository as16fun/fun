// Top bar: the way back to the portfolio, brand, search (events, streets, sources), case study, share/embed, menu.
import { h, frag, copyText, trapFocus } from '../util/dom.js';
import { ICONS } from './icons.js';
import { confBadge, numBadge } from './cards.js';
import { fmtClock, fmtRange } from '../util/time.js';

// The concept lives inside the portfolio: these are the ways back to it.
export const PORTFOLIO_URL = './#stop-eindhoven'; // the Mapcreator stop, where the case studies are
export const CASE_STUDY_URL = 'case-studies/story-maps/';

/** Back to wherever in the portfolio the visitor came from (a case study), else the Mapcreator stop. */
export function portfolioHref() {
  try {
    const ref = new URL(document.referrer);
    if (ref.origin === location.origin && /\/case-studies\//.test(ref.pathname)) return ref.pathname;
  } catch { /* no referrer */ }
  return PORTFOLIO_URL;
}

export function createTopbar({ root, model, store, roads, actions }) {
  // ── Back link & brand ───────────────────────────────────────────────────────
  const back = h('a.back-link', { href: portfolioHref(), target: window.top !== window ? '_top' : null }, frag(ICONS.chevronLeft),
    h('span.back-long', 'Back to portfolio'), h('span.back-short', 'Portfolio'));
  const brand = h('a.brand', { href: 'dispatch.html', 'aria-label': 'Storyline, reload the story' },
    h('span.brand-mark', { html: LOGO }), h('span.brand-name', 'Storyline'));

  // ── Search ──────────────────────────────────────────────────────────────────
  const index = buildIndex(model, roads);
  const input = h('input.search-input', {
    type: 'search', placeholder: 'Search events and streets', 'aria-label': 'Search events and streets',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'search-results', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false',
  });
  const results = h('div.search-results.popover', { id: 'search-results', role: 'listbox', 'aria-label': 'Search results', hidden: true });
  const search = h('div.search', { role: 'search' }, h('span.search-icon', frag(ICONS.search)), input, h('kbd.search-kbd', { 'aria-hidden': 'true' }, '/'), results);
  let options = [];
  let active = -1;

  function runSearch() {
    const q = norm(input.value.trim());
    if (!q) return closeResults();
    const groups = [
      ['Events', index.events.filter((x) => x.text.includes(q))],
      ['Streets', index.streets.filter((x) => x.text.includes(q))],
    ].map(([label, list]) => [label, list.sort((a, b) => rank(b, q) - rank(a, q)).slice(0, label === 'Events' ? 6 : 5)]);
    options = [];
    results.replaceChildren();
    for (const [label, list] of groups) {
      if (!list.length) continue;
      const gid = `sg-${label}`;
      results.append(h('div.search-group', { role: 'group', 'aria-labelledby': gid },
        h('p.search-group-label', { id: gid }, label),
        list.map((item) => {
          const i = options.length;
          const opt = h('div.search-option', { role: 'option', id: `so-${i}`, 'aria-selected': 'false', dataset: { i } }, item.render());
          opt.addEventListener('pointerdown', (ev) => ev.preventDefault());
          opt.addEventListener('click', () => choose(i));
          options.push({ item, opt });
          return opt;
        })));
    }
    if (!options.length) results.append(h('p.search-empty', `No events, streets or sources match “${input.value.trim()}”.`));
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(options.length ? 0 : -1);
  }
  function setActive(i) {
    active = i;
    options.forEach(({ opt }, j) => opt.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', options[i].opt.id);
      options[i].opt.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function choose(i) {
    const o = options[i];
    if (!o) return;
    closeResults();
    input.blur();
    document.documentElement.classList.remove('search-open');
    o.item.choose();
  }
  function closeResults() {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    options = [];
  }
  input.addEventListener('input', runSearch);
  input.addEventListener('focus', () => { if (input.value) runSearch(); });
  input.addEventListener('blur', () => setTimeout(closeResults, 120));
  document.addEventListener('pointerdown', (ev) => { if (!search.contains(ev.target)) closeResults(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(Math.min(options.length - 1, active + 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (ev.key === 'Enter') { ev.preventDefault(); choose(active); }
    else if (ev.key === 'Escape') {
      ev.stopPropagation();
      if (input.value) { input.value = ''; closeResults(); } else { input.blur(); document.documentElement.classList.remove('search-open'); }
    }
  });

  function buildIndex() {
    const events = model.events.map((e) => ({
      text: norm([e.title, e.summary, e.place, e.typeLabel, ...e.sources.map((s) => s.name)].join(' ')),
      title: norm(e.title),
      render: () => [numBadge(e), h('span.so-main', h('span.so-title', e.title), h('span.so-sub', `${fmtRange(e.start, e.end)} · ${e.place || e.typeLabel}`)), confBadge(e.confidence, { compact: true })],
      choose: () => actions.selectEvent(e.id),
    }));
    const byName = new Map();
    for (const f of roads.features) {
      const name = f.properties.name;
      if (!name || f.geometry.type !== 'LineString') continue;
      if (!byName.has(name)) byName.set(name, [Infinity, Infinity, -Infinity, -Infinity]);
      const b = byName.get(name);
      for (const [x, y] of f.geometry.coordinates) {
        b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
      }
    }
    const streets = [...byName.entries()].map(([name, bbox]) => {
      const mentions = model.events.filter((e) => norm(`${e.title} ${e.summary} ${e.place}`).includes(norm(name))).length;
      return {
        text: norm(name), title: norm(name), weight: mentions,
        render: () => [h('span.so-icon', frag(ICONS.target)), h('span.so-main', h('span.so-title', name), h('span.so-sub', mentions ? `Street · in ${mentions} event${mentions === 1 ? '' : 's'}` : 'Street'))],
        choose: () => actions.focusStreet(name, bbox),
      };
    });
    const sources = model.sources.map((s) => ({
      text: norm(`${s.name} ${s.typeLabel}`), title: norm(s.name),
      render: () => [h('span.so-icon', frag(ICONS[s.type] ?? ICONS.info)), h('span.so-main', h('span.so-title', s.name), h('span.so-sub', `${s.typeLabel} · cited in ${s.citedBy.length} event${s.citedBy.length === 1 ? '' : 's'}`))],
      choose: () => actions.showSource(s.id),
    }));
    return { events, streets, sources };
  }

  // ── Actions: case study, share, menu ───────────────────────────────────────
  const caseBtn = h('a.btn.ghost.topbar-case', { href: CASE_STUDY_URL }, frag(ICONS.book), h('span', 'Case study'));
  const shareBtn = h('button.btn.primary.topbar-share', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, frag(ICONS.share), h('span', 'Share'));
  const menuBtn = h('button.icon-btn.topbar-menu', { type: 'button', 'aria-label': 'Menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, frag(ICONS.menu));

  const linkInput = h('input.share-input', { type: 'text', readonly: true, 'aria-label': 'Link to this moment' });
  const embedInput = h('textarea.share-input.share-code', { readonly: true, rows: 4, 'aria-label': 'Embed code' });
  const embedLink = h('a.share-preview', { target: '_blank', rel: 'noopener' }, 'Preview the embed', frag(ICONS.external));
  const copyBtn = (target, label) => h('button.btn.small', {
    type: 'button',
    onclick: async (ev) => {
      const btn = ev.currentTarget;
      const ok = await copyText(target.value);
      btn.textContent = ok ? 'Copied' : 'Press ⌘C';
      target.select();
      setTimeout(() => { btn.textContent = label; }, 1600);
    },
  }, label);
  const sharePop = h('div.popover.share-pop', { role: 'dialog', 'aria-label': 'Share or embed', hidden: true },
    h('p.pop-title', 'Share this moment'),
    h('p.pop-sub', 'The link opens the story at the current time and selected event.'),
    h('div.share-row', linkInput, copyBtn(linkInput, 'Copy')),
    h('p.pop-title', 'Embed in an article'),
    h('p.pop-sub', 'Map, timeline and a compact headline, sized for an iframe.'),
    embedInput,
    h('div.share-row.end', embedLink, copyBtn(embedInput, 'Copy code')));

  const menuItem = (icon, label, onclick, cls = '') => h(`button.menu-item${cls}`, { type: 'button', role: 'menuitem', onclick: () => { closePops(); onclick(); } }, frag(ICONS[icon]), label);
  const menuPop = h('div.popover.menu-pop', { role: 'menu', 'aria-label': 'Menu', hidden: true },
    menuItem('chevronLeft', 'Back to portfolio', () => { location.href = back.href; }),
    menuItem('search', 'Search', () => actions.openSearch(), '.mobile-only'),
    menuItem('book', 'Case study', () => { location.href = CASE_STUDY_URL; }, '.mobile-only'),
    menuItem('share', 'Share or embed', () => setTimeout(() => openPop(sharePop, shareBtn), 0), '.mobile-only'),
    menuItem('keyboard', 'Keyboard shortcuts', () => actions.openShortcuts()),
    menuItem('info', 'About this demo', () => actions.openAbout()),
    menuItem('sparkle', 'Replay intro', () => actions.replayIntro()),
    menuItem('target', 'Reset view', () => actions.resetView()),
    menuItem('code', 'Open embed view', () => window.open(embedUrl(), '_blank', 'noopener')));

  const actionsEl = h('div.topbar-actions', caseBtn);
  const el = h('header.topbar', h('div.topbar-left', brand, back), search, actionsEl);
  root.append(el);

  // Popovers
  let openEl = null;
  let release = null;
  function openPop(pop, btn) {
    closePops();
    if (pop === sharePop) refreshShare();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openEl = { pop, btn };
    release = trapFocus(pop);
    (pop.querySelector('button, input, textarea, a') ?? pop).focus();
  }
  function closePops(returnFocus = false) {
    if (!openEl) return;
    openEl.pop.hidden = true;
    openEl.btn.setAttribute('aria-expanded', 'false');
    release?.();
    if (returnFocus) openEl.btn.focus();
    openEl = null;
  }
  shareBtn.addEventListener('click', () => (openEl?.pop === sharePop ? closePops() : openPop(sharePop, shareBtn)));
  menuBtn.addEventListener('click', () => (openEl?.pop === menuPop ? closePops() : openPop(menuPop, menuBtn)));
  document.addEventListener('pointerdown', (ev) => {
    if (openEl && !openEl.pop.contains(ev.target) && !openEl.btn.contains(ev.target)) closePops();
  });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && openEl) { ev.stopPropagation(); closePops(true); }
    if (openEl?.pop === menuPop && ['ArrowDown', 'ArrowUp'].includes(ev.key)) {
      ev.preventDefault();
      const items = [...menuPop.querySelectorAll('.menu-item')].filter((n) => n.offsetParent !== null);
      const i = items.indexOf(document.activeElement);
      items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });

  function momentHash() {
    const s = store.get();
    return `#t=${fmtClock(s.t)}${s.selectedId ? `&event=${s.selectedId}` : ''}`;
  }
  function baseUrl() {
    const u = new URL(location.href);
    u.hash = '';
    u.searchParams.delete('embed');
    return u.toString().replace(/\?$/, '');
  }
  function embedUrl() {
    const u = new URL(baseUrl());
    u.searchParams.set('embed', '1');
    return `${u}${momentHash()}`;
  }
  function refreshShare() {
    linkInput.value = `${baseUrl()}${momentHash()}`;
    embedInput.value = `<iframe src="${embedUrl()}" title="${model.story.title}, Storyline story map (fictional demo)" width="100%" height="620" style="border:0;border-radius:12px" loading="lazy" allow="fullscreen"></iframe>`;
    embedLink.href = embedUrl();
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      ev.preventDefault();
      actions.openSearch();
    }
  });

  return {
    el,
    update() {},
    focusSearch() {
      document.documentElement.classList.add('search-open');
      input.focus();
    },
    momentUrl: () => `${baseUrl()}${momentHash()}`,
    linkFor: (e) => `${baseUrl()}#t=${fmtClock(Math.max(e.start, store.get().t))}&event=${e.id}`,
  };
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const rank = (item, q) => (item.title.startsWith(q) ? 3 : item.title.includes(` ${q}`) ? 2 : item.title.includes(q) ? 1.5 : 1) + (item.weight ?? 0) * 0.1;

export const LOGO = '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="16" fill="#0E1220"/><g transform="translate(16 15.5) scale(0.7) translate(-16.4 -15.5)"><path d="M27.9707 25.2833L18.1852 3.97022L18.1755 3.95166C18.0114 3.61519 17.7561 3.33154 17.4388 3.13298C17.1214 2.93441 16.7547 2.82889 16.3804 2.82843C16.006 2.82797 15.6391 2.93258 15.3212 3.13037C15.0034 3.32816 14.7475 3.61118 14.5825 3.94724C14.5788 3.95314 14.5755 3.95935 14.5728 3.9658L4.79174 25.2833C4.60923 25.6553 4.54858 26.0753 4.61839 26.4837C4.68821 26.8921 4.88494 27.2682 5.18065 27.5584L5.20716 27.5849C5.5082 27.8814 5.89654 28.0733 6.31492 28.1324C6.73329 28.1914 7.15957 28.1145 7.53089 27.9129L7.55388 27.9005L16.3786 22.9366L25.2033 27.9005L25.2262 27.9129C25.5981 28.1097 26.0225 28.1843 26.4392 28.126C26.8559 28.0676 27.2435 27.8794 27.547 27.588C27.8506 27.2967 28.0544 26.917 28.1297 26.5031C28.205 26.0891 28.1478 25.662 27.9663 25.2824L27.9707 25.2833ZM16.8709 20.9169C16.7214 20.8329 16.5527 20.7888 16.3812 20.7888C16.2097 20.7888 16.0411 20.8329 15.8915 20.9169L6.59663 26.146L6.60635 26.1256L16.3812 4.81786L26.157 26.123L26.1658 26.1424L16.8709 20.9169Z" fill="#fff" stroke="#fff" stroke-width="0.75" stroke-linejoin="round"/></g></svg>';
