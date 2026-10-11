import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '../styles/casestudy.css';

import { h, frag, rafThrottle } from '../util/dom.js';
import { ICONS } from '../ui/icons.js';
import { renderCaseStudy } from './render.js';
import { initSphere } from './sphere.js';
import { renderTopbar } from './shared.js';
import { isPlaceholder, contactTarget, contactAttrs } from '../util/contact.js';

const root = document.body.dataset.root ?? '../../';
const backHash = document.body.dataset.back ?? '';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

boot().catch((err) => {
  console.error(err);
  document.getElementById('article').replaceChildren(h('p.cs-loading', `Could not load the case study: ${err.message}`));
});

async function boot() {
  // A folder URL without the trailing slash would break relative paths, so normalise it.
  if (!location.pathname.endsWith('/') && !location.pathname.endsWith('.html')) {
    location.replace(`${location.pathname}/${location.search}${location.hash}`);
    return;
  }
  const [md, journey] = await Promise.all([
    fetch('case-study.md').then((r) => { if (!r.ok) throw new Error(`case-study.md: HTTP ${r.status}`); return r.text(); }),
    fetch(`${root}journey/journey.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const person = journey?.person ?? {};
  const { html, title, sections } = renderCaseStudy(md, { base: '' });
  document.title = `${title} · Case study`;

  renderTopbar(person, { root });

  const article = document.getElementById('article');
  article.innerHTML = html;
  const { role, validation } = decorate(article);
  setupLiveHero(article);
  dressHero(article, role);
  dressContext(article, validation);
  dressStatement(article);
  dressSections(article);
  dressDecision(article);
  dressRounds(article);
  dressDecisions(article);
  dressDecisionBoxes(article);
  dressClosing(article);
  dressTests(article);
  dressFindings(article);
  dressChanged(article);
  mergeOutcome(article);
  setupScrolly(article);
  dressCaptions(article);
  justifyGalleries(article);
  const openImage = setupLightbox(article);
  setupRotate(article, openImage);
  setupPins(article);
  for (const stage of article.querySelectorAll('.cs-sphere-stage')) initSphere(stage);
  renderFooter(journey);
  setupReveal();
  trackProgress();

  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}

/** A caption's text as one line, with the colon the bold title/description split took out. */
function captionText(fig) {
  const cap = fig?.querySelector('figcaption');
  if (!cap) return '';
  const title = cap.querySelector('.cs-cap-title');
  return title ? `${title.textContent}: ${cap.querySelector('.cs-cap-text')?.textContent ?? ''}` : cap.textContent;
}

/** Screenshots open full size: click (or Enter) on an image; click anywhere or Esc to close. Numbered pins come along. */
function setupLightbox(article) {
  const img = h('img.cs-lightbox-img', { alt: '' });
  const pins = h('div.cs-lightbox-pins', { 'aria-hidden': 'true' });
  const caption = h('p.cs-lightbox-caption');
  const dialog = h('dialog.cs-lightbox', { 'aria-label': 'Enlarged image' },
    h('button.cs-lightbox-close', { type: 'button', 'aria-label': 'Close' }, frag(ICONS.close)),
    h('figure.cs-lightbox-figure', h('div.cs-lightbox-media', img, pins), caption));
  document.body.append(dialog);
  dialog.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => img.removeAttribute('src'));
  const open = (pic, text) => {
    img.src = pic.currentSrc || pic.src;
    img.alt = pic.alt;
    pins.replaceChildren(...[...(pic.closest('.cs-shot-media')?.querySelectorAll('.cs-pin') ?? [])].map((pin) => pin.cloneNode(true)));
    caption.textContent = text ?? '';
    caption.hidden = !caption.textContent;
    dialog.showModal();
  };
  for (const pic of article.querySelectorAll('.cs-figure:not(.cs-live) img')) {
    if (pic.closest('.cs-rotate')) continue; // those open from their own stack (setupRotate)
    const zoom = h('button.cs-zoom', { type: 'button', 'aria-label': `Enlarge image: ${pic.alt}` });
    pic.replaceWith(zoom);
    zoom.append(pic);
    zoom.addEventListener('click', () => open(pic, captionText(pic.closest('.cs-figure'))));
  }
  return open;
}

/** Images that take turns (the sign-up artwork): a cross-fade every 5 seconds, one click to enlarge the one on show. */
function setupRotate(article, openImage) {
  for (const fig of article.querySelectorAll('.cs-rotate')) {
    const media = fig.querySelector('.cs-rotate-media');
    const pics = [...media.querySelectorAll('img')];
    const dots = [...fig.querySelectorAll('.cs-rotate-dots i')];
    let k = 0;
    const enlarge = () => openImage(pics[k], captionText(fig));
    media.addEventListener('click', enlarge);
    media.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); enlarge(); } });
    if (reducedMotion || pics.length < 2) continue;
    setInterval(() => {
      pics[k].classList.remove('is-on'); dots[k]?.classList.remove('is-on');
      k = (k + 1) % pics.length;
      pics[k].classList.add('is-on'); dots[k]?.classList.add('is-on');
    }, 5000);
  }
}

/** Pointing at a note lights up its pin on the screenshot. */
function setupPins(article) {
  for (const li of article.querySelectorAll('.cs-shot .cs-notes li[data-pin]')) {
    const pin = li.closest('.cs-shot').querySelector(`.cs-shot-media .cs-pin[data-pin="${li.dataset.pin}"]`);
    if (!pin) continue;
    li.addEventListener('mouseenter', () => pin.classList.add('is-active'));
    li.addEventListener('mouseleave', () => pin.classList.remove('is-active'));
  }
}

/** Gallery figures grow by their image's aspect ratio, so a row shares one height. */
function justifyGalleries(article) {
  for (const img of article.querySelectorAll('.cs-gallery img')) {
    const set = () => img.naturalWidth && img.closest('.cs-figure').style.setProperty('--ar', (img.naturalWidth / img.naturalHeight).toFixed(4));
    if (img.complete) set();
    else img.addEventListener('load', set, { once: true });
  }
}

/**
 * Gives the opening its editorial roles: the label ("Case study - Mapcreator (2022)"), lead,
 * byline, the project facts as meta columns and the hero image. Returns the Role fact, which
 * goes on the hero's "My Role" card instead of the columns.
 */
function decorate(article) {
  const h1 = article.querySelector('h1');
  if (!h1) return {};
  // "Title ~ result": the result reads as the title's quieter tail
  const tail = h1.textContent.match(/^(.*\S)\s+~\s+(.+)$/);
  if (tail) h1.replaceChildren(`${tail[1]} `, h('span.cs-title-muted', `~ ${tail[2]}`));
  const [org, ...rest] = (document.body.dataset.kicker ?? '').split(' · ');
  h1.before(h('p.cs-eyebrow', h('b', org ? `Case study - ${org}` : 'Case study'), rest.length ? ` (${rest.join(' · ')})` : null));
  let el = h1.nextElementSibling;
  if (el?.tagName === 'P' && el.childElementCount === 1 && el.firstElementChild.tagName === 'EM' && el.textContent.trim() === el.firstElementChild.textContent.trim()) {
    el.classList.add('cs-lead');
    el = el.nextElementSibling;
  }
  if (el?.tagName === 'P' && !el.matches('.cs-proto') && el.textContent.length < 80) {
    el.classList.add('cs-byline');
    const words = article.textContent.trim().split(/\s+/).length;
    el.append(h('span.cs-read-time', ` · ${Math.max(1, Math.round(words / 230))} min read`));
    el = el.nextElementSibling;
  }
  // the prototype link and the topic tags stay with the standfirst
  const extras = [];
  while (el?.matches('.cs-proto, .cs-tags')) { extras.push(el); el = el.nextElementSibling; }
  // the hero is the first figure before the first chapter (key numbers may sit above it)
  let hero = null;
  for (let x = el; x && !x.matches('h2'); x = x.nextElementSibling) if (x.matches('.cs-figure')) { hero = x; break; }
  if (hero) {
    hero.classList.add('cs-hero');
    hero.querySelector('img')?.setAttribute('loading', 'eager');
    hero.querySelector('img')?.setAttribute('fetchpriority', 'high');
  }

  // "Project overview" holds only the facts table: it moves up, under the byline.
  let role = null;
  let validation = null;
  const overview = article.querySelector('#project-overview');
  const facts = overview?.nextElementSibling?.matches('.cs-facts') ? overview.nextElementSibling : null;
  if (facts) {
    for (const item of [...facts.children]) {
      if (item.querySelector('dt')?.textContent.trim().toLowerCase() === 'validation') validation = item.querySelector('dd')?.textContent.trim() ?? null;
      if (item.querySelector('dt')?.textContent.trim().toLowerCase() !== 'role') continue;
      role = item.querySelector('dd')?.textContent.trim() ?? null;
      item.remove();
    }
    for (const item of [...facts.children]) {
      if (item.querySelector('dt')?.textContent.trim().toLowerCase() === 'brief') item.remove(); // the standfirst already says it
    }
    facts.classList.replace('cs-facts', 'cs-meta');
    // long answers need the card's full width
    if ([...facts.children].slice(0, 2).some((d) => (d.querySelector('dd')?.textContent.trim().length ?? 0) > 60)) facts.classList.add('is-stacked');
    article.querySelector('.cs-byline')?.remove(); // the date and reading time are not shown
    overview.remove();
  }

  // Title and standfirst on the left, the project at a glance in a card on the right.
  const eyebrow = article.querySelector('.cs-eyebrow');
  const lead = article.querySelector('.cs-lead');
  const main = h('div.cs-head-main');
  const head = h('div.cs-head', main);
  eyebrow.before(head);
  main.append(eyebrow, h1, ...(lead ? [lead] : []), ...extras);
  if (facts) head.append(facts);
  return { role, validation };
}

/** The hero gets a short label on the image (`data-hero-label`, "Name: value") and the lime role card. */
function dressHero(article, role) {
  const hero = article.querySelector('.cs-hero');
  const media = hero?.querySelector('.cs-live-stage') ?? hero?.querySelector('.cs-sphere-stage') ?? hero?.querySelector('img');
  if (!media) return;
  const wrap = h('div.cs-hero-media');
  media.replaceWith(wrap);
  wrap.append(media);
  // Under the image: what it shows and its caption on the left, "My role" on the right.
  const label = document.body.dataset.heroLabel;
  let title = label ? (label.includes(':') ? label.split(':').slice(1).join(':').trim() : label) : null;
  const cap = hero.querySelector('figcaption');
  if (!title && cap) {
    const text = cap.textContent.trim();
    const i = text.indexOf(': ');
    if (i > 0 && i < 60) {
      title = text.slice(0, i);
      cap.textContent = text.charAt(i + 2).toUpperCase() + text.slice(i + 3);
    }
  }
  const info = h('div.cs-hero-info', title ? h('p.cs-hero-title', title) : null, cap ?? null);
  hero.append(h('div.cs-hero-bar', info,
    role ? h('div.cs-hero-role', h('span.cs-hero-role-label', 'My role'), h('p', role)) : null));
}

/**
 * The opening paragraphs become a "project context" block: a title and the validation on the left,
 * the story on the right, and the one bold sentence as a dark card underneath.
 */
function dressContext(article, validation) {
  const title = document.body.dataset.contextTitle;
  const hero = article.querySelector('.cs-hero');
  if (!title || !hero) return;
  const paras = [];
  let shift = null;
  for (let el = hero.nextElementSibling; el && el.tagName === 'P'; el = el.nextElementSibling) {
    if (el.childElementCount === 1 && el.firstElementChild.tagName === 'STRONG' && el.textContent.trim() === el.firstElementChild.textContent.trim()) { shift = el; break; }
    paras.push(el);
  }
  if (!paras.length) return;
  const [org, ...rest] = (document.body.dataset.kicker ?? '').split(' · ');
  const block = h('section.cs-context', { 'aria-label': 'Project context' },
    h('div.cs-context-top', h('span.cs-context-label', 'Project context'), org ? h('span.cs-context-meta', [org, ...rest].join(' · ')) : null),
    h('div.cs-context-grid',
      h('div.cs-context-side',
        h('h2.cs-context-title', title),
        validation ? h('div.cs-context-fact', h('span.cs-context-fact-label', 'Concept validation'), h('p', validation)) : null),
      h('div.cs-context-body', paras)),
    shift ? h('div.cs-shift', h('p.cs-shift-label', 'The shift'), h('p.cs-shift-text', shift.textContent.trim())) : null);
  hero.after(block);
  shift?.remove();
}

/** A bold-only sentence in the opening (before the first chapter) becomes the light statement card. */
function dressStatement(article) {
  for (const el of [...article.children]) {
    if (el.matches('.cs-chap-head, h2')) break;
    if (el.tagName !== 'P' || el.childElementCount !== 1 || el.firstElementChild.tagName !== 'STRONG') continue;
    if (el.textContent.trim() !== el.firstElementChild.textContent.trim()) continue;
    el.replaceWith(h('div.cs-chap-card.cs-statement', h('p.cs-chap-card-text', el.textContent.trim())));
  }
}

/**
 * Each numbered chapter opens the same way: a label row, the title with a big number and a progress
 * bar on the left, the opening paragraphs on the right, and a bold closing line as a light card.
 */
function dressSections(article) {
  const heads = [...article.querySelectorAll('h2.cs-h2')];
  const total = heads.filter((h2) => h2.querySelector('.cs-h2-num')).length;
  const [org] = (document.body.dataset.kicker ?? '').split(' · ');
  const pad = (n) => String(n).padStart(2, '0');
  for (const h2 of heads) {
    const num = h2.querySelector('.cs-h2-num');
    if (!num) {
      h2.before(h('p.cs-eyebrow.cs-section-label', h('b', 'Overview')));
      continue;
    }
    const n = parseInt(num.textContent, 10);
    num.remove();
    const title = h2.textContent.trim();
    const kicker = h2.dataset.kicker;
    if (title.length > 40) h2.classList.add('is-long');

    // leading paragraphs go to the right; a bold-only paragraph (with an optional lead-in) becomes the card
    const paras = [];
    let label = null;
    let statement = null;
    for (let el = h2.nextElementSibling; el && el.tagName === 'P'; el = el.nextElementSibling) {
      if (el.childElementCount === 1 && el.firstElementChild.tagName === 'STRONG' && el.textContent.trim() === el.firstElementChild.textContent.trim()) {
        statement = el;
        if (paras.length && /:\s*$/.test(paras.at(-1).textContent)) label = paras.pop();
        break;
      }
      paras.push(el);
    }

    const marker = document.createComment('chapter');
    h2.before(marker);
    const bar = h('div.cs-chap-bar', { 'aria-hidden': 'true' }, Array.from({ length: total }, (_, k) => h(`i${k < n - 1 ? '.is-done' : k === n - 1 ? '.is-current' : ''}`)));
    const head = h('section.cs-chap-head', { 'aria-label': `Chapter ${pad(n)}` },
      h('div.cs-chap-top',
        h('span.cs-chap-label', `Chapter ${pad(n)} (of ${pad(total)})`),
        h('span.cs-chap-meta', [org, kicker ?? title].filter(Boolean).join(' · '))),
      h('div.cs-chap-grid',
        h('div.cs-chap-side', h2, h('p.cs-chap-num', pad(n), h('span', `/ ${pad(total)}`)), bar),
        h('div.cs-chap-body', paras)),
      statement
        ? h('div.cs-chap-card',
          label ? h('p.cs-chap-card-label', label.textContent.trim()) : null,
          h('p.cs-chap-card-text', statement.textContent.trim()))
        : null);
    marker.replaceWith(head);
    label?.remove();
    statement?.remove();
  }
}

/** "**Label:** text" becomes a small bold label with the text under it. */
function testItem(el) {
  const strong = el.querySelector('strong');
  const label = strong?.textContent.trim() ?? '';
  const text = el.textContent.replace(label, '').trim();
  return h('div.cs-test-item', label ? h('p.cs-test-item-label', label) : null, h('p.cs-test-item-text', text));
}

/**
 * The first decision of a chapter that opens with it ("1. Choose the map…") moves into the chapter head:
 * a "Decision 01" label, its title and paragraphs on the right, and a gate card with the benchmark and the rounds below.
 */
function dressDecision(article) {
  for (const head of article.querySelectorAll('.cs-chap-head')) {
    const h3 = head.nextElementSibling;
    if (!h3?.matches('h3.cs-h3')) continue;
    const num = h3.querySelector('.cs-h3-num');
    if (!num) continue;
    const n = parseInt(num.textContent, 10);
    num.remove();
    const body = head.querySelector('.cs-chap-body');
    if (!body) continue;
    const paras = [];
    const rounds = [];
    let el = h3.nextElementSibling;
    for (; el && el.tagName === 'P' && !(el.childElementCount === 1 && el.firstElementChild.tagName === 'STRONG' && el.textContent.trim() === el.firstElementChild.textContent.trim()); el = el.nextElementSibling) paras.push(el);
    for (let r = el; r && !r.matches('h2, h3, .cs-chap-head'); r = r.nextElementSibling) {
      const m = r.tagName === 'P' && /^Round\s+(\d+):\s*(.+)$/.exec(r.textContent.trim());
      if (m) rounds.push([m[1], m[2]]);
    }
    const bench = /at least (\d+) out of (\d+)/i.exec(paras.map((x) => x.textContent).join(' '));
    body.append(h('p.cs-decision-label', `Decision ${String(n).padStart(2, '0')}`),
      h('h3.cs-decision-title', h3.textContent.trim()), ...paras);
    h3.remove();
    if (bench && rounds.length) {
      head.after(h('section.cs-gate', { 'aria-label': 'The gate before high fidelity' },
        h('div.cs-gate-top',
          h('div.cs-gate-score', h('p.cs-gate-label', 'The gate before high fidelity'),
            h('p.cs-gate-num', bench[1], h('span', `/ ${bench[2]} minimum`))),
          h('p.cs-gate-text', 'Ease of reading, not preference, would guide the primary map choice.')),
        h('ol.cs-gate-rounds', rounds.map(([k, title]) => h('li', h('span', `Round ${String(k).padStart(2, '0')}`), h('strong', title))))));
    }
  }
}

/** The other numbered decisions get the same treatment as the first: a label and a big title with the text on the right. */
function dressDecisions(article) {
  if (document.body.dataset.scrolly) return; // that page lays its ideas out as a scrolling story
  for (const h3 of [...article.querySelectorAll(':scope > h3.cs-h3')]) {
    const num = h3.querySelector('.cs-h3-num');
    if (!num) continue;
    const n = parseInt(num.textContent, 10);
    num.remove();
    const group = [];
    for (let el = h3.nextElementSibling; el && !el.matches('h2, h3, .cs-chap-head, .cs-round, .cs-gate, .cs-test, .cs-compare'); el = el.nextElementSibling) group.push(el);
    const isMedia = (el) => el.matches('figure, .cs-gallery, .cs-figure, .cs-todo');
    const text = group.filter((el) => !isMedia(el));
    const media = group.filter(isMedia);
    const marker = document.createComment('decision');
    h3.before(marker);
    const sec = h('section.cs-dec', { 'aria-label': `Decision ${n}` },
      h('div.cs-dec-side'),
      h('div.cs-dec-body',
        h('p.cs-decision-label', `Decision ${String(n).padStart(2, '0')}`),
        h('h3.cs-decision-title', h3.textContent.trim()),
        ...text));
    marker.replaceWith(sec);
    h3.remove();
    let ref = sec;
    for (const m of media) { ref.after(m); ref = m; }
  }
}

/** "The decision: Do this. Because that." becomes the dark card: label, the decision as a title, the reason below. */
function buildDecisionCard(raw) {
  const t = raw.replace(/^The decision:\s*/, '').trim();
  const cut = t.indexOf('. ');
  return h('div.cs-decision-card', h('p.cs-decision-card-label', 'The decision'),
    h('p.cs-decision-card-title', cut > 0 ? t.slice(0, cut + 1) : t),
    cut > 0 ? h('p.cs-decision-card-text', t.slice(cut + 2)) : null);
}

function dressDecisionBoxes(article) {
  for (const el of article.querySelectorAll('.cs-decision')) {
    const card = buildDecisionCard(el.textContent);
    if (el.classList.contains('cs-reveal')) card.classList.add('cs-reveal');
    el.replaceWith(card);
  }
}

/** Any bold-only sentence left in the body becomes a dark statement card, without a label. */
function dressClosing(article) {
  for (const el of [...article.querySelectorAll(':scope > p')]) {
    if (el.childElementCount !== 1 || el.firstElementChild.tagName !== 'STRONG') continue;
    if (el.textContent.trim() !== el.firstElementChild.textContent.trim()) continue;
    const card = h('div.cs-closing', h('p.cs-closing-text', el.textContent.trim()));
    if (el.classList.contains('cs-reveal')) card.classList.add('cs-reveal');
    el.replaceWith(card);
  }
}

const ROUND_COPY = {
  1: { sub: 'Equal space for states, less familiar geography.', head: 'The grid made orientation harder.' },
  2: { sub: 'Familiar positions improved recognition; the count needed more clarity.', head: 'Recognition improved. The result states still competed.' },
  3: { title: 'Refined design & final decision', sub: 'The geographic map passed the reading benchmark.' },
};

/** A rebuilt score card: label, big score, participants, bar with the 4/5 tick and a status line. */
function scoreCard(src) {
  const small = src.querySelector('small');
  const total = small?.textContent.replace('/', '').trim() ?? '5';
  const value = src.querySelector('.cs-score-value')?.textContent.replace(small?.textContent ?? '', '').trim();
  const meta = src.querySelector('.cs-score-meta')?.textContent ?? '';
  const people = /(\d+)\s*participants/i.exec(meta)?.[1];
  if (!value) return null;
  const pass = src.classList.contains('is-pass');
  return h(`div.cs-sc${pass ? '.is-pass' : ''}`,
    h('p.cs-sc-label', 'Ease of reading'),
    h('div.cs-sc-row', h('p.cs-sc-num', value, h('span', `/ ${total}`)), people ? h('p.cs-sc-n', `${people} participants`) : null),
    h('div.cs-sc-bar', h('i', { style: { width: `${(parseFloat(value) / parseFloat(total)) * 100}%` } }), h('u')),
    h('div.cs-sc-scale', h('span', '0'), h('span.cs-sc-tick', '4/5'), h('span', total)),
    h('p.cs-sc-status', pass ? 'Above the 4/5 benchmark' : 'Below the 4/5 benchmark'));
}

/** Each "Round N: title" becomes a section: score card and visual on the left, what the test revealed on the right. */
function dressRounds(article) {
  const labels = [...article.children].filter((el) => /^Round\s+\d+:/.test(el.textContent.trim()) && el.textContent.length < 70 && !el.querySelector('img'));
  const total = labels.length;
  const cards = [];
  labels.forEach((lab, idx) => {
    const m = /^Round\s+(\d+):\s*(.+)$/.exec(lab.textContent.trim());
    const n = Number(m[1]);
    const group = [];
    for (let el = lab.nextElementSibling; el && !labels.includes(el) && !el.matches('h2, h3, .cs-chap-head'); el = el.nextElementSibling) group.push(el);
    const score = group.find((e) => e.matches('.cs-score'));
    const changed = group.find((e) => e.matches('.cs-changed'));
    const fig = group.find((e) => e.matches('figure'));
    const decision = group.find((e) => /^The decision:/.test(e.textContent.trim()));
    const paras = group.filter((e) => e.tagName === 'P' && e !== decision);
    const copy = ROUND_COPY[n] ?? {};
    const sc = score && scoreCard(score);
    if (sc) cards.push({ n, title: m[2], sc: scoreCard(score) });

    let decisionCard = null;
    if (decision) {
      const t = decision.textContent.replace(/^The decision:\s*/, '').trim();
      const cut = t.indexOf('. ');
      decisionCard = h('div.cs-decision-card', h('p.cs-decision-card-label', 'The decision'),
        h('p.cs-decision-card-title', cut > 0 ? t.slice(0, cut + 1) : t),
        cut > 0 ? h('p.cs-decision-card-text', t.slice(cut + 2)) : null);
    }
    if (fig) fig.querySelector('figcaption')?.remove();
    const sec = h('section.cs-round', { 'aria-label': `Round ${n}` },
      h('p.cs-round-label', `Round ${n} / ${total}`),
      h('h3.cs-round-title', copy.title ?? m[2]),
      copy.sub ? h('p.cs-round-sub', copy.sub) : null,
      h('div.cs-round-grid',
        h('div.cs-round-left', sc, fig ?? null),
        h('div.cs-round-right',
          copy.head ? h('p.cs-round-kicker', 'What the test revealed') : null,
          copy.head ? h('h4.cs-round-head', copy.head) : null,
          ...paras.map((p) => { p.classList.add('cs-round-text'); return p; }),
          changed ?? null,
          decisionCard)));
    const marker = document.createComment('round');
    lab.before(marker);
    marker.replaceWith(sec);
    lab.remove(); score?.remove(); decision?.remove();
  });
  if (cards.length > 1) {
    const last = article.querySelectorAll('.cs-round');
    last[last.length - 1].after(h('section.cs-compare', { 'aria-label': 'Three rounds compared' },
      h('div.cs-compare-top', h('h3.cs-compare-title', 'Three rounds, one reading benchmark'), h('p.cs-compare-note', '0-5 scale · target ≥ 4/5')),
      h('div.cs-compare-grid', cards.map((c) => h('div.cs-compare-col',
        h('p.cs-compare-name', h('span', c.title), h('em', `Round ${c.n}`)), c.sc)))));
  }
}

/** "Test 1: …" with its hypothesis and prototype becomes one card: label and title left, the two lines right. */
function dressTests(article) {
  for (const h3 of article.querySelectorAll('h3.cs-h3')) {
    const m = /^Test\s+(\d+):/.exec(h3.textContent.trim());
    const hyp = h3.nextElementSibling;
    const proto = hyp?.nextElementSibling;
    if (!m || hyp?.tagName !== 'P' || proto?.tagName !== 'UL') continue;
    const marker = document.createComment('test');
    h3.before(marker);
    const card = h('section.cs-test', { 'aria-label': `Round ${m[1]}` },
      h('div.cs-test-side', h('p.cs-test-label', `Round ${m[1]}`), h3),
      h('div.cs-test-body', testItem(hyp), testItem(proto.querySelector('li') ?? proto)));
    marker.replaceWith(card);
    hyp.remove();
    proto.remove();
  }
}

/** "Fictional findings: 5/8 readers …" becomes a small label and the finding as large text. */
function dressFindings(article) {
  for (const ul of article.querySelectorAll(':scope > ul.cs-list')) {
    const li = ul.children.length === 1 ? ul.firstElementChild : null;
    const strong = li?.querySelector('strong');
    if (!strong || !/^Fictional findings/i.test(strong.textContent)) continue;
    const label = strong.textContent.replace(/:\s*$/, '').trim();
    const text = li.textContent.replace(strong.textContent, '').trim();
    const m = /^(\d+\/\d+\s+\S+)\s+(.*)$/.exec(text);
    ul.replaceWith(h('section.cs-finding', { 'aria-label': label },
      h('p.cs-finding-label', label),
      h('p.cs-finding-text', m ? [h('strong', m[1]), ` ${m[2]}`] : text)));
  }
}

/** "**What changed:** Added a …" becomes a titled card; the thing that was added is bold. */
function dressChanged(article) {
  for (const p of article.querySelectorAll('p.cs-changed')) {
    const strong = p.querySelector('strong');
    if (!strong) continue;
    const title = strong.textContent.replace(/:\s*$/, '').trim();
    const text = p.textContent.replace(strong.textContent, '').trim();
    const m = /^(Added (?:an? )?)(.*?\.)\s*(.*)$/.exec(text);
    const body = m ? [m[1], h('strong', m[2]), m[3] ? ` ${m[3]}` : ''] : text;
    const card = h('div.cs-changed', h('p.cs-changed-title', title), h('p.cs-changed-text', body));
    if (p.classList.contains('cs-reveal')) card.classList.add('cs-reveal');
    p.replaceWith(card);
  }
}

/** The findings and "What changed" that follow a test share one card. */
function mergeOutcome(article) {
  for (const finding of article.querySelectorAll(':scope > .cs-finding')) {
    const changed = finding.nextElementSibling;
    if (!changed?.matches('.cs-changed')) continue;
    const marker = document.createComment('outcome');
    finding.before(marker);
    const card = h('section.cs-outcome', finding, changed);
    marker.replaceWith(card);
  }
}

/** Figure captions "Name: what it shows" become a bold line and the description under it, like the hero. */
function dressCaptions(article) {
  const split = (el) => {
    if (!el || el.childElementCount) return;
    const text = el.textContent.trim();
    const i = text.indexOf(': ');
    if (i < 1 || i > 70) return;
    const rest = text.slice(i + 2);
    el.replaceChildren(h('strong.cs-cap-title', text.slice(0, i)), h('span.cs-cap-text', rest.charAt(0).toUpperCase() + rest.slice(1)));
  };
  for (const fig of article.querySelectorAll('figure.cs-figure:not(.cs-hero)')) split(fig.querySelector('figcaption'));
  // side-by-side images in the scrolling section share one caption block of spans
  for (const span of article.querySelectorAll('.cs-scrolly-caption > span')) split(span);
}

function renderFooter(journey) {
  const contact = contactTarget(journey?.person);
  const all = (journey?.chapters ?? []).flatMap((c) => c.caseStudies?.items ?? []);
  const current = document.body.dataset.case ?? '';
  const others = all.filter((cs) => !current || !(cs.url ?? '').includes(current));
  const footer = document.getElementById('footer');
  footer.append(
    h('div.cs-footer-inner',
      others.length
        ? h('section.cs-next', { 'aria-labelledby': 'next-title' },
          h('p.cs-eyebrow', { id: 'next-title' }, h('b', 'More case studies')),
          others.map((cs) => {
            const ready = cs.url && !isPlaceholder(cs.url);
            return h(`div.cs-next-card${cs.image ? '.has-thumb' : ''}`,
              cs.image && ready ? h('a.cs-next-thumb', { href: `${root}${cs.url}`, tabindex: '-1', 'aria-hidden': 'true' }, h('img', { src: `${root}${cs.image}`, alt: '', loading: 'lazy', decoding: 'async' })) : null,
              h('div.cs-next-body',
                cs.tag ? h('p.cs-next-tag', cs.tag) : null,
                h('h3.cs-next-title', cs.title),
                cs.summary ? h('p.cs-next-summary', cs.summary) : null,
                h('p.cs-next-meta',
                  ready ? h('a.cs-next-read', { href: `${root}${cs.url}` }, 'Read the case study', frag(ICONS.arrowRight ?? ICONS.chevronRight)) : h('span.cs-soon', 'Case study coming soon'),
                  cs.demo?.url ? h('a.cs-next-demo', { href: `${root}${cs.demo.url}` }, cs.demo.label ?? 'View', frag(ICONS.arrowUpRight)) : null)));
          }))
        : null,
      // Someone who read to the end is the most likely to reach out: offer it here too.
      h('div.cs-footer-actions',
        h('a.cs-btn.primary', contactAttrs(contact, `${root}#contact`), 'Get in touch', contact?.external ? frag(ICONS.arrowUpRight) : null),
        h('a.cs-btn', { href: `${root}${backHash}` }, frag(ICONS.chevronLeft), 'Back to the journey'))));
}

/**
 * The hero screenshot doubles as a poster for the live prototype (`data-live` on the body):
 * one click swaps it for the real thing, embedded. Phones open the full prototype instead.
 */
function setupLiveHero(article) {
  const src = document.body.dataset.live;
  const hero = article.querySelector('.cs-hero');
  const poster = hero?.querySelector('img');
  if (!src || !poster) return;
  const full = document.body.dataset.liveFull ?? src;
  hero.classList.add('cs-live');
  const stage = h('div.cs-live-stage');
  poster.replaceWith(stage);
  const play = h('button.cs-live-play', { type: 'button' },
    frag(ICONS.play), h('span', 'Play the prototype'));
  stage.append(poster, play);
  // Play opens the whole prototype in real full screen; Esc (or its own "Back to portfolio") returns here.
  play.addEventListener('click', () => {
    if (matchMedia('(max-width: 640px)').matches || !document.fullscreenEnabled) { location.href = full; return; }
    const frame = h('iframe', { src: full, title: 'Storyline, the live prototype (fictional demo scenario)', allow: 'fullscreen' });
    const layer = h('div.cs-fs', frame);
    document.body.append(layer);
    layer.requestFullscreen().then(() => frame.focus({ preventScroll: true }), () => { layer.remove(); location.href = full; });
    layer.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) layer.remove(); });
  });
}

/**
 * Scrollytelling for one section (`data-scrolly` = its id): the ideas scroll on the left while a
 * sticky frame on the right shows each one's visual. Below 820 px the section stays stacked.
 * Only one of the two copies of each visual is ever displayed, so each is read once.
 */
function setupScrolly(article) {
  const head = document.getElementById(document.body.dataset.scrolly ?? '');
  if (!head) return;
  const blocks = [];
  for (let el = (head.closest('.cs-chap-head') ?? head).nextElementSibling; el && !el.matches('h2, .cs-chap-head, .cs-section-label'); el = el.nextElementSibling) blocks.push(el);
  const first = blocks.findIndex((el) => el.matches('h3'));
  if (first < 0) return;
  const ideas = [];
  for (const el of blocks.slice(first)) {
    if (el.matches('h3')) ideas.push({ head: el, parts: [], media: [] });
    else (el.matches('.cs-figure, .cs-gallery') ? ideas.at(-1).media : ideas.at(-1).parts).push(el);
  }
  if (ideas.length < 2) return;

  const frames = ideas.map((idea) => {
    const copies = idea.media.map((m) => m.cloneNode(true));
    // Side-by-side images share one caption block under them instead of squeezing their own.
    const caps = copies.flatMap((c) => [...c.querySelectorAll('figcaption')]);
    if (caps.length > 1) caps.forEach((cap) => cap.remove());
    return h('div.cs-scrolly-frame', h('div.cs-scrolly-visual', copies),
      caps.length > 1 ? h('p.cs-scrolly-caption', caps.map((cap) => h('span', cap.textContent))) : null);
  });
  const dots = ideas.map(() => h('i'));
  const count = h('span.cs-scrolly-count');
  const steps = ideas.map((idea, k) => h('div.cs-scrolly-step', { dataset: { i: k } }));
  const wrap = h('div.cs-scrolly',
    h('div.cs-scrolly-steps', steps),
    h('div.cs-scrolly-media', h('div.cs-scrolly-stage', frames, h('div.cs-scrolly-meta', count, h('span.cs-scrolly-dots', dots)))));
  blocks[first].before(wrap);
  ideas.forEach((idea, k) => steps[k].append(idea.head, ...idea.parts, ...idea.media));

  let current = -1;
  const show = (k) => {
    if (k === current) return;
    current = k;
    frames.forEach((f, j) => f.classList.toggle('is-active', j === k));
    steps.forEach((s, j) => s.classList.toggle('is-active', j === k));
    dots.forEach((d, j) => d.classList.toggle('is-active', j === k));
    count.textContent = `${String(k + 1).padStart(2, '0')} / ${String(ideas.length).padStart(2, '0')}`;
  };
  show(0);
  // The idea crossing the middle of the screen is the one on show.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) show(Number(e.target.dataset.i));
  }, { rootMargin: '-50% 0px -50% 0px' });
  steps.forEach((s) => io.observe(s));
}

/** Blocks rise into place as they scroll into view; grids and timelines stagger their items. */
function setupReveal() {
  if (reducedMotion || !('IntersectionObserver' in window)) return;
  const targets = document.querySelectorAll(`.cs-article > :is(.cs-figure:not(.cs-hero), .cs-gallery, .cs-facts, .cs-metrics, .cs-statement, .cs-section-label,
    .cs-decision, .cs-changed, .cs-score, .cs-todo, .cs-timeline, .cs-launch, blockquote, .cs-h2, .cs-h3, .cs-label, .cs-table-wrap, .cs-cta,
    .cs-rot, .cs-numbers, .cs-insights, .cs-principles, .cs-dirs-wrap, .cs-data, .cs-model, .cs-features, .cs-growth-wrap, .cs-try, .cs-stage, .cs-next, .cs-callout),
    .cs-scrolly-step > :is(.cs-h3, .cs-figure, .cs-gallery), .cs-next-card`);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  for (const el of targets) {
    el.classList.add('cs-reveal');
    [...el.children].forEach((child, k) => child.style.setProperty('--i', k));
    io.observe(el);
  }
}

function trackProgress() {
  const bar = document.querySelector('.cs-progress span');
  const update = rafThrottle(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
  });
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

