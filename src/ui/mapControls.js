// Zoom in / out and reset view, bottom-right; plus the OpenStreetMap attribution.
import { h, frag } from '../util/dom.js';
import { ICONS } from './icons.js';

export function createMapControls({ root, api }) {
  const btn = (icon, label, onclick) => h('button.icon-btn', { type: 'button', 'aria-label': label, title: label, onclick }, frag(ICONS[icon]));
  const el = h('div.map-controls', { role: 'group', 'aria-label': 'Map view' },
    btn('plus', 'Zoom in', () => api.zoomBy(0.75)),
    btn('minus', 'Zoom out', () => api.zoomBy(-0.75)),
    h('span.sep', { 'aria-hidden': 'true' }),
    btn('target', 'Reset view', () => api.resetView()));
  const attribution = h('p.attribution',
    '© ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap'), ' contributors');
  root.append(el, attribution);
  return { el, update() {} };
}
