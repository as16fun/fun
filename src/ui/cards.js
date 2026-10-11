// Small presentational pieces shared by the sidebar, the detail card and search.
import { h, frag } from '../util/dom.js';
import { ICONS, GLYPHS } from './icons.js';
import { CONFIDENCE } from '../config.js';
import { fmtRange } from '../util/time.js';

export function confBadge(conf, { compact = false } = {}) {
  return h('span.conf-badge', { dataset: { conf } },
    h('span.conf-glyph', frag(GLYPHS[conf])),
    compact ? null : CONFIDENCE[conf].label);
}

export function numBadge(e) {
  return h('span.num-badge', { dataset: { conf: e.confidence }, 'aria-hidden': 'true' }, String(e.n));
}

export function typeIcon(type) {
  return h('span.type-icon', { 'aria-hidden': 'true' }, frag(ICONS[type] ?? ICONS.info));
}

/** An event as a card: number, time, type, title, confidence and number of sources. */
export function eventCard(e, { onSelect, ongoing = false, selected = false } = {}) {
  const card = h('button.ev-card', {
    type: 'button',
    dataset: { id: e.id, conf: e.confidence },
    'aria-label': `${e.n}. ${e.title}. ${fmtRange(e.start, e.end)}, ${e.typeLabel}. ${CONFIDENCE[e.confidence].label}, ${e.sources.length} source${e.sources.length === 1 ? '' : 's'}.`,
    'aria-pressed': selected ? 'true' : 'false',
  },
  numBadge(e),
  h('span.ev-main',
    h('span.ev-meta', h('time', fmtRange(e.start, e.end)), h('span.dot', '·'), typeIcon(e.type), e.typeLabel),
    h('span.ev-title', e.title),
    h('span.ev-foot', confBadge(e.confidence),
      h('span.ev-sources', frag(ICONS.reporter), `${e.sources.length} source${e.sources.length === 1 ? '' : 's'}`))));
  card.addEventListener('click', () => onSelect?.(e.id));
  return card;
}

export function reliabilityMeter(level) {
  const n = { high: 3, medium: 2, low: 1 }[level] ?? 0;
  return h('span.reliability', { dataset: { level: level ?? 'unknown' }, title: `Reliability: ${level ?? 'unknown'}` },
    h('span.reliability-dots', { 'aria-hidden': 'true' }, [1, 2, 3].map((i) => h(`span${i <= n ? '.on' : ''}`))),
    h('span.reliability-label', level ? `${level[0].toUpperCase()}${level.slice(1)} reliability` : 'Reliability unknown'));
}
