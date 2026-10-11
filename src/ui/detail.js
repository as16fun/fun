// Detail card for the selected event: when, where, how well it is sourced (and why),
// the crowd range with any competing claims, and every source with its timestamp.

import { h, frag, fmtInt } from '../util/dom.js';
import { ICONS } from './icons.js';
import { confBadge, numBadge, typeIcon, reliabilityMeter } from './cards.js';
import { CONFIDENCE } from '../config.js';
import { fmtClock, fmtRange, fmtDuration } from '../util/time.js';

export function createDetail({ root, model, store, onSelect, onClose, onJump, onCopyLink }) {
  const el = h('section.detail', { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'detail-title', tabindex: '-1', hidden: true });
  root.append(el);
  let shownId = null;
  let crowdNow = null;
  let returnFocus = null;

  function render(e) {
    const idx = model.events.indexOf(e);
    const prev = model.events[idx - 1];
    const next = model.events[idx + 1];
    crowdNow = null;
    el.dataset.conf = e.confidence;
    el.replaceChildren(
      h('header.detail-head',
        numBadge(e),
        h('span.detail-type', typeIcon(e.type), e.typeLabel),
        h('button.icon-btn.detail-close', { type: 'button', 'aria-label': 'Close details (Esc)', title: 'Close (Esc)', onclick: () => onClose() }, frag(ICONS.close))),
      h('div.detail-body',
        h('h2.detail-title', { id: 'detail-title' }, e.title),
        h('p.detail-when',
          h('span', frag(ICONS.clock), h('time', fmtRange(e.start, e.end))),
          e.isRange ? h('span.muted', fmtDuration(e.end - e.start)) : null,
          e.place ? h('span', frag(ICONS.target), e.place) : null),
        h('div.detail-conf', { dataset: { conf: e.confidence } },
          confBadge(e.confidence),
          h('p', h('strong', CONFIDENCE[e.confidence].short), e.confidenceNote ? ` ${e.confidenceNote}` : '')),
        h('p.detail-summary', e.summary),
        e.quote
          ? h('blockquote.detail-quote', h('p', `“${e.quote.text}”`), h('cite', `— ${e.quote.attribution}`))
          : null,
        // Sources stay folded until the reader opens them.
        h('details.detail-sources-wrap',
          h('summary.detail-sub', `Sources (${e.sources.length})`, frag(ICONS.chevronDown)),
          h('ul.detail-sources', e.sources.map((src) => h('li.detail-source',
          h('span.source-icon', frag(ICONS[src.type] ?? ICONS.info)),
          h('div',
            h('p.detail-source-top', h('strong', src.name), h('span.muted', src.typeLabel),
              src.timestamp != null ? h('time.detail-source-time', fmtClock(src.timestamp)) : null),
            src.detail ? h('p.detail-source-detail', src.detail) : null,
            h('p.detail-source-meta',
              src.reliability ? reliabilityMeter(src.reliability) : null,
              src.link
                ? h('a', { href: src.link, target: '_blank', rel: 'noopener noreferrer', title: 'Placeholder link for the demo' }, 'Placeholder link', frag(ICONS.external))
                : null))))))),
      h('footer.detail-foot',
        h('button.btn.ghost.small', { type: 'button', disabled: !prev, onclick: () => prev && onSelect(prev.id, 'detail') }, frag(ICONS.chevronLeft), 'Previous'),
        h('button.btn.ghost.small', { type: 'button', onclick: () => onJump(e), title: 'Set the clock to the start of this event' }, frag(ICONS.clock), fmtClock(e.start)),
        h('button.btn.ghost.small', { type: 'button', onclick: (ev) => copied(ev.currentTarget, onCopyLink(e)) }, frag(ICONS.link), 'Copy link'),
        h('button.btn.ghost.small', { type: 'button', disabled: !next, onclick: () => next && onSelect(next.id, 'detail') }, 'Next', frag(ICONS.chevronRight))));
  }

  function crowdBlock(e) {
    const c = e.crowd;
    const max = Math.max(c.high, ...c.claims.map((cl) => cl.estimate)) * 1.08;
    const pct = (v) => `${(v / max) * 100}%`;
    crowdNow = h('span.crowd-now');
    return h('div.detail-crowd',
      h('div.crowd-head', h('h3.detail-sub', 'Crowd estimate'), crowdNow),
      h('p.crowd-peak', h('strong', `≈${fmtInt(c.estimate)}`), h('span.muted', ` at the peak · likely between ${fmtInt(c.low)} and ${fmtInt(c.high)}`)),
      h('div.range', { role: 'img', 'aria-label': `Estimate ${fmtInt(c.estimate)}, range ${fmtInt(c.low)} to ${fmtInt(c.high)}${c.claims.map((cl) => `; ${cl.name} claim ${fmtInt(cl.estimate)}`).join('')}` },
        h('span.range-band', { style: { left: pct(c.low), width: `calc(${pct(c.high)} - ${pct(c.low)})` } }),
        h('span.range-est', { style: { left: pct(c.estimate) } }),
        c.claims.map((cl) => h('span.range-claim', { style: { left: pct(cl.estimate) }, title: `${cl.name}: ${fmtInt(cl.estimate)}` }))),
      c.claims.length
        ? h('ul.claims', c.claims.map((cl) => h('li', h('span.claim-dot'), h('span', cl.name), h('strong', fmtInt(cl.estimate)),
          cl.timestamp != null ? h('time.muted', fmtClock(cl.timestamp)) : null)))
        : null);
  }

  function copied(btn, promise) {
    Promise.resolve(promise).then((ok) => {
      const label = btn.lastChild;
      const old = label.textContent;
      label.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { label.textContent = old; }, 1600);
    });
  }

  function update(st, s) {
    const id = s.selectedId;
    if (!id) {
      if (shownId) {
        el.hidden = true;
        shownId = null;
        if (returnFocus && document.activeElement && el.contains(document.activeElement)) returnFocus.focus?.({ preventScroll: true });
      }
      return;
    }
    const e = model.byId.get(id);
    if (id !== shownId) {
      if (!shownId) returnFocus = document.activeElement;
      shownId = id;
      render(e);
      el.hidden = false;
      el.scrollTop = 0;
      el.querySelector('.detail-body').scrollTop = 0;
      el.focus({ preventScroll: true });
    }
    const es = st.ev.get(id);
    if (crowdNow) {
      const c = es.crowd;
      crowdNow.textContent = c && c.estimate > 1 ? `Now (${fmtClock(st.t)}): ≈${fmtInt(c.estimate)}` : `Not on the map at ${fmtClock(st.t)}`;
    }
  }

  return { el, update, isOpen: () => !!shownId };
}
