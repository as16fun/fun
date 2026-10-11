// Compact layer switches and the legend, top-right of the map.
import { h, frag } from '../util/dom.js';
import { ICONS, GLYPHS } from './icons.js';
import { CONFIDENCE } from '../config.js';

const LAYERS = [
  ['events', 'Events', 'Numbered pins'],
  ['movement', 'Movement', 'Marches and dispersal'],
  ['crowd', 'Crowd size', 'Estimate and range'],
  ['closures', 'Closures & reroutes', 'Roads and buses'],
  ['buildings', 'Affected buildings', 'Tinted by role'],
];

export function createLayersPanel({ root, store }) {
  const switches = LAYERS.map(([key, label, sub]) => h('button.layer-switch', {
    type: 'button', role: 'switch', 'aria-checked': 'true', dataset: { layer: key },
    onclick: () => {
      const layers = { ...store.get().layers, [key]: !store.get().layers[key] };
      store.set({ layers });
    },
  }, h(`span.layer-swatch.sw-${key}`, { 'aria-hidden': 'true' }), h('span.layer-text', h('span', label), h('small', sub)), h('span.toggle', { 'aria-hidden': 'true' })));

  const legend = h('div.legend', { id: 'legend' },
    h('h3.legend-title', 'Confidence'),
    h('ul.legend-list', Object.entries(CONFIDENCE).map(([k, c]) => h('li',
      h('span.mini-pin', { dataset: { conf: k }, 'aria-hidden': 'true' }, h('span.mini-glyph', frag(GLYPHS[k]))),
      h('span', h('strong', c.label), h('small', LEGEND_STYLE[k]))))),
    h('h3.legend-title', 'On the map'),
    h('ul.legend-list',
      h('li', h('span.lg.lg-trail', { 'aria-hidden': 'true' }), h('span', h('strong', 'Movement'), h('small', 'Dots and a fading trail'))),
      h('li', h('span.lg.lg-crowd', { 'aria-hidden': 'true' }, h('i'), h('b')), h('span', h('strong', 'Crowd'), h('small', 'Solid = low estimate, glass = high'))),
      h('li', h('span.lg.lg-closure', { 'aria-hidden': 'true' }), h('span', h('strong', 'Closed road'), h('small', 'Coral band with tape'))),
      h('li', h('span.lg.lg-reroute', { 'aria-hidden': 'true' }), h('span', h('strong', 'Diverted buses'), h('small', 'Moving coral dashes'))),
      h('li', h('span.lg.lg-bld', { 'aria-hidden': 'true' }, h('i'), h('b')), h('span', h('strong', 'Buildings'), h('small', 'Blue involved, coral incident/closed')))));

  const legendToggle = h('button.legend-toggle', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'legend' }, 'Legend', frag(ICONS.chevronDown));
  const body = h('div.layers-body', { id: 'layers-body' }, h('div.layer-list', { role: 'group', 'aria-label': 'Map layers' }, switches), legendToggle, legend);
  const toggle = h('button.layers-toggle', { type: 'button', 'aria-expanded': 'true', 'aria-controls': 'layers-body' },
    frag(ICONS.layers), h('span', 'Layers'), frag(ICONS.chevronDown));
  const el = h('section.layers', { 'aria-label': 'Layers and legend' }, toggle, body);
  root.append(el);

  let open = false; // collapsed by default, on every screen size
  let legendOpen = false;
  const setOpen = (v) => {
    open = v;
    el.classList.toggle('is-collapsed', !open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  const setLegend = (v) => {
    legendOpen = v;
    el.classList.toggle('legend-open', legendOpen);
    legendToggle.setAttribute('aria-expanded', String(legendOpen));
  };
  toggle.addEventListener('click', () => setOpen(!open));
  legendToggle.addEventListener('click', () => setLegend(!legendOpen));
  setLegend(false);

  let wasMobile = null;
  function update(st, s) {
    for (const sw of switches) sw.setAttribute('aria-checked', String(!!s.layers[sw.dataset.layer]));
    if (s.mobile !== wasMobile) {
      wasMobile = s.mobile;
      setOpen(false);
    }
  }
  return { el, update, setOpen };
}

const LEGEND_STYLE = {
  confirmed: 'Solid blue ✓',
  reported: 'Outlined blue “',
  unverified: 'Dashed amber ?',
  disputed: 'Split amber ≠',
};
