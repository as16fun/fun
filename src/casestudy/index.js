// The case studies page: every case study listed in the journey, most recent first.
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '../styles/casestudy.css';

import { h, frag } from '../util/dom.js';
import { ICONS } from '../ui/icons.js';
import { isPlaceholder, contactTarget, contactAttrs } from '../util/contact.js';
import { renderTopbar } from './shared.js';

const root = document.body.dataset.root ?? '../';

const journey = await fetch(`${root}journey/journey.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const person = journey?.person ?? {};
renderTopbar(person, { root });

const all = (journey?.chapters ?? []).flatMap((c) => c.caseStudies?.items ?? []);
// most recent first; the journey's own order breaks ties
const items = all.map((cs, i) => ({ cs, i })).sort((a, b) => (Number(b.cs.year) || 0) - (Number(a.cs.year) || 0) || a.i - b.i).map((x) => x.cs);

document.title = 'Case studies';
document.getElementById('article').replaceChildren(
  h('p.cs-eyebrow', h('b', 'Case studies')),
  h('h1.cs-title', 'Case studies'),
  h('p.cs-lead', `${items.length} projects, from the most recent to the least recent.`),
  h('div.cs-cases', items.map((cs) => {
    const ready = cs.url && !isPlaceholder(cs.url);
    return h(`div.cs-next-card${cs.image ? '.has-thumb' : ''}`,
      cs.image && ready ? h('a.cs-next-thumb', { href: `${root}${cs.url}`, tabindex: '-1', 'aria-hidden': 'true' }, h('img', { src: `${root}${cs.image}`, alt: '', loading: 'lazy', decoding: 'async' })) : null,
      h('div.cs-next-body',
        cs.tag ? h('p.cs-next-tag', cs.tag) : null,
        h('h2.cs-next-title', cs.title),
        cs.summary ? h('p.cs-next-summary', cs.summary) : null,
        h('p.cs-next-meta',
          ready ? h('a.cs-next-read', { href: `${root}${cs.url}` }, 'Read the case study', frag(ICONS.arrowRight)) : h('span.cs-soon', 'Case study coming soon'),
          cs.demo?.url ? h('a.cs-next-demo', { href: `${root}${cs.demo.url}` }, cs.demo.label ?? 'View', frag(ICONS.arrowUpRight)) : null)));
  })));

const contact = contactTarget(person);
document.getElementById('footer').append(h('div.cs-footer-inner',
  h('div.cs-footer-actions',
    h('a.cs-btn.primary', contactAttrs(contact, `${root}#contact`), 'Get in touch', contact?.external ? frag(ICONS.arrowUpRight) : null),
    h('a.cs-btn', { href: root }, frag(ICONS.chevronLeft), 'Back to the journey'))));
