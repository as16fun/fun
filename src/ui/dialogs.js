// Small modal dialogs: keyboard shortcuts and "about this demo".
import { h, frag, trapFocus } from '../util/dom.js';
import { ICONS } from './icons.js';

export function createDialogs({ root, model }) {
  const content = h('div.dialog-content');
  const closeBtn = h('button.icon-btn.dialog-close', { type: 'button', 'aria-label': 'Close' }, frag(ICONS.close));
  const box = h('div.dialog-box', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title', tabindex: '-1' }, closeBtn, content);
  const el = h('div.dialog', { hidden: true }, h('div.dialog-backdrop'), box);
  root.append(el);
  let release = null;
  let returnTo = null;

  function open(title, body) {
    returnTo = document.activeElement;
    content.replaceChildren(h('h2.dialog-title', { id: 'dialog-title' }, title), ...body);
    el.hidden = false;
    release = trapFocus(box);
    box.focus();
  }
  function close() {
    el.hidden = true;
    release?.();
    returnTo?.focus?.();
  }
  closeBtn.addEventListener('click', close);
  el.firstChild.addEventListener('click', close);
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
  });

  const kbd = (...keys) => h('span.keys', keys.map((k) => h('kbd', k)));
  return {
    isOpen: () => !el.hidden,
    shortcuts() {
      open('Keyboard shortcuts', [h('dl.shortcuts',
        row(kbd('Space'), 'Play or pause'),
        row(kbd('←', '→'), 'Previous / next event'),
        row(kbd('Esc'), 'Close the detail card or panel'),
        row(kbd('/'), 'Search events, streets and sources'),
        row(kbd('Tab'), 'Move through pins, cards and controls'),
        row(kbd('↑', '↓'), 'On the timeline: one minute (with Shift: five)'),
        row(kbd('Home', 'End'), 'On the timeline: start / end of the evening'))]);
    },
    about() {
      open('About this demo', [
        h('p', h('strong', 'Storyline'), ' is a 3D story-map tool for newsrooms: a journalist lays out how an event unfolded across a city, and readers scrub through it, follow movements and see what is confirmed and what is not.'),
        h('p.callout', frag(ICONS.info), h('span', model.story.disclaimer)),
        h('p', 'Buildings, streets, water and trees come from OpenStreetMap (© OpenStreetMap contributors, ODbL). Heights use OSM tags where present and a seeded estimate otherwise. The map renders with MapLibre GL JS, without tiles or API keys.'),
        h('p', 'A newsroom can swap ', h('code', 'data/story.json'), ' for its own story: chapters, events, sources, confidence levels and crowd estimates all come from that one file.'),
      ]);
    },
  };
}

const row = (k, v) => h('div.shortcut-row', h('dt', k), h('dd', v));
