// Projected DOM on top of the map: numbered event pins, crowd labels and the outline
// of the hovered/selected event building. Positions are recomputed after every map frame.

import { h, frag } from '../util/dom.js';
import { GLYPHS } from './icons.js';
import { CONFIDENCE } from '../config.js';
import { fmtRange } from '../util/time.js';

const STEM = 16;
const HEAD = 30;

export function createOverlay({ root, api, model, buildings, storyLayers, onSelect, onHover }) {
  const outlineSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  outlineSvg.setAttribute('class', 'outline-layer');
  outlineSvg.setAttribute('aria-hidden', 'true');
  const labelLayer = h('div.crowd-labels', { 'aria-hidden': 'true' });
  const pinLayer = h('div.pins', { role: 'list', 'aria-label': 'Events on the map, in chronological order' });
  const edgeLayer = h('div.pin-edges', { 'aria-hidden': 'true' });
  root.append(outlineSvg, labelLayer, pinLayer, edgeLayer);

  const pins = model.events.map((e) => {
    const el = h('button.pin', {
      type: 'button',
      role: 'listitem',
      dataset: { conf: e.confidence, id: e.id },
      'aria-label': `Event ${e.n}: ${e.title}. ${fmtRange(e.start, e.end)}. ${CONFIDENCE[e.confidence].label}.`,
      hidden: true,
    },
    h('span.pin-head', h('span.pin-num', String(e.n)), h('span.pin-glyph', frag(GLYPHS[e.confidence]))),
    h('span.pin-stem'),
    h('span.pin-foot'));
    el.addEventListener('click', (ev) => { ev.stopPropagation(); onSelect(e.id, 'pin'); });
    // A chip on the screen edge stands in for the pin while it is outside the free map area.
    el.addEventListener('pointerenter', () => onHover(e.id));
    el.addEventListener('pointerleave', () => onHover(null));
    el.addEventListener('focus', () => onHover(e.id));
    el.addEventListener('blur', () => onHover(null));
    pinLayer.append(el);
    const edge = h('button.pin-edge', { type: 'button', tabindex: '-1', dataset: { conf: e.confidence }, title: `Event ${e.n}: ${e.title}`, hidden: true },
      h('span.pin-edge-arrow'), h('span.pin-edge-num', String(e.n)));
    edge.addEventListener('click', (ev) => { ev.stopPropagation(); onSelect(e.id, 'pin'); });
    edgeLayer.append(edge);
    return { e, el, edge, visible: false, x: 0, y: 0, stem: STEM, arrivedAt: 0 };
  });

  const labels = new Map();
  let lastState = null;
  let lastT = null;
  let ui = { selectedId: null, hoverId: null, layers: {} };

  function update(st, nextUi) {
    ui = nextUi;
    const forward = lastT != null && st.t > lastT && st.t - lastT < 30;
    for (const p of pins) {
      const s = st.ev.get(p.e.id);
      const vis = !!ui.layers.events && s.vis;
      if (vis !== p.visible) {
        p.visible = vis;
        p.el.hidden = !vis;
        if (!vis) { p.edge.hidden = true; p.el.style.visibility = ''; }
        if (vis && forward) {
          p.el.classList.remove('is-arriving');
          void p.el.offsetWidth; // restart the CSS animation
          p.el.classList.add('is-arriving');
          clearTimeout(p.arriveTimer);
          p.arriveTimer = setTimeout(() => p.el.classList.remove('is-arriving'), 1600);
        }
      }
      p.el.classList.toggle('is-selected', ui.selectedId === p.e.id);
      p.el.classList.toggle('is-hovered', ui.hoverId === p.e.id);
      p.el.classList.toggle('is-ongoing', s.ongoing);
      p.el.setAttribute('aria-current', ui.selectedId === p.e.id ? 'true' : 'false');
    }
    lastT = st.t;
    lastState = st;
    reposition();
  }

  function reposition() {
    if (!lastState) return;
    const visible = pins.filter((p) => p.visible);
    for (const p of visible) {
      const pt = api.screenAt(p.e.geom.anchor, p.e.geom.altitude ? p.e.geom.altitude + 1 : 0);
      p.x = pt.x;
      p.y = pt.y;
    }
    // Declutter: pins whose heads would overlap get a taller stem, stacking upwards.
    const placed = [];
    for (const p of [...visible].sort((a, b) => a.e.n - b.e.n)) {
      let stem = STEM;
      for (let level = 0; level < 4; level++) {
        const hy = p.y - stem - HEAD / 2;
        if (!placed.some((q) => Math.abs(q.x - p.x) < HEAD + 2 && Math.abs(q.hy - hy) < HEAD + 2)) break;
        stem += HEAD + 4;
      }
      p.stem = stem;
      placed.push({ x: p.x, hy: p.y - stem - HEAD / 2 });
      p.el.style.setProperty('--stem', `${stem}px`);
      p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      // nearer (lower on screen) pins draw on top; the selected one always wins
      p.el.style.zIndex = ui.selectedId === p.e.id ? 1000 : Math.round(p.y);
    }
    positionEdges(visible);
    positionLabels();
    drawOutline();
  }

  /**
   * Pins outside the free map area (off screen, under a panel or under a floating control) show as
   * a numbered chip on its edge, with an arrow towards the pin. Each event shows once: pin or chip.
   */
  let freeArea = null; // the padding main.js gives the map, so chips follow it even mid-animation
  function positionEdges(visible) {
    const W = root.clientWidth, H = root.clientHeight;
    const pad = freeArea ?? api.map.getPadding();
    const box = { l: pad.left + 16, r: W - pad.right - 16, t: pad.top + 16, b: H - pad.bottom - 16 };
    const cx = (box.l + box.r) / 2, cy = (box.t + box.b) / 2;
    const rootRect = root.getBoundingClientRect();
    // Things floating inside the free area: the layers panel, the zoom buttons, the map credit.
    const blocks = [...document.querySelectorAll('.layers, .explore-btn, .map-controls, .attribution')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { l: r.left - rootRect.left, r: r.right - rootRect.left, t: r.top - rootRect.top, b: r.bottom - rootRect.top }; });
    // Each edge keeps its longest stretch that no control covers.
    const span = { t: [box.l, box.r], b: [box.l, box.r], l: [box.t, box.b], r: [box.t, box.b] };
    const cut = (side, a, b) => {
      const [lo, hi] = span[side];
      const before = [lo, Math.min(hi, a)], after = [Math.max(lo, b), hi];
      span[side] = before[1] - before[0] >= after[1] - after[0] ? before : after;
    };
    const M = 18; // clearance around a control
    for (const o of blocks) {
      if (o.t - M <= box.t && o.b + M >= box.t) cut('t', o.l - M, o.r + M);
      if (o.t - M <= box.b && o.b + M >= box.b) cut('b', o.l - M, o.r + M);
      if (o.l - M <= box.l && o.r + M >= box.l) cut('l', o.t - M, o.b + M);
      if (o.l - M <= box.r && o.r + M >= box.r) cut('r', o.t - M, o.b + M);
    }
    const chips = [];
    for (const p of visible) {
      const hx = p.x, hy = p.y - p.stem - HEAD / 2;
      const covered = blocks.some((o) => hx > o.l && hx < o.r && hy > o.t && hy < o.b);
      const outside = covered || hx < box.l - 6 || hx > box.r + 6 || hy < box.t - 6 || hy > box.b + 6;
      p.edge.hidden = !outside;
      p.el.style.visibility = outside ? 'hidden' : '';
      if (!outside) continue;
      // From the centre of the free area towards the pin, onto the edge.
      const dx = hx - cx || 1e-6, dy = hy - cy || 1e-6;
      const k = Math.min(Math.abs((dx > 0 ? box.r - cx : box.l - cx) / dx), Math.abs((dy > 0 ? box.b - cy : box.t - cy) / dy));
      const x = cx + dx * k, y = cy + dy * k;
      const side = Math.abs(y - box.t) < 0.5 ? 't' : Math.abs(y - box.b) < 0.5 ? 'b' : x < cx ? 'l' : 'r';
      chips.push({ p, hx, hy, x, y, side });
    }
    // Along each edge: inside its free stretch, and 30 px apart.
    const GAP = 30;
    for (const side of ['t', 'b', 'l', 'r']) {
      const axis = side === 't' || side === 'b' ? 'x' : 'y';
      const [lo, hi] = span[side];
      const row = chips.filter((c) => c.side === side).sort((a, b) => a[axis] - b[axis]);
      for (let i = 0; i < row.length; i++) row[i][axis] = Math.max(row[i][axis], lo, i ? row[i - 1][axis] + GAP : -Infinity);
      for (let i = row.length - 1; i >= 0; i--) row[i][axis] = Math.min(row[i][axis], hi, i < row.length - 1 ? row[i + 1][axis] - GAP : Infinity);
    }
    for (const c of chips) {
      c.p.edge.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0)`;
      c.p.edge.style.setProperty('--angle', `${(Math.atan2(c.hy - c.y, c.hx - c.x) * 180 / Math.PI).toFixed(1)}deg`);
    }
  }

  function positionLabels() {
    const show = !!ui.layers.crowd;
    for (const item of storyLayers.crowdLabels(lastState)) {
      let el = labels.get(item.e.id);
      if (!el) {
        el = h('div.crowd-label', { dataset: { conf: item.e.confidence } }, h('strong'), h('span'));
        labels.set(item.e.id, el);
        labelLayer.append(el);
      }
      // A label follows its event: hidden while the event shows as an edge chip.
      const off = pins.find((p) => p.e.id === item.e.id && p.visible && !p.edge.hidden);
      const on = show && item.crowd.estimate >= 15 && !off;
      el.hidden = !on;
      if (!on) continue;
      const pt = api.screenAt(item.lngLat, item.altitude);
      el.firstChild.textContent = `≈${fmt(item.crowd.estimate)}`;
      el.lastChild.textContent = `${fmt(item.crowd.low)}–${fmt(item.crowd.high)}`;
      // Keep the label clear of pin heads: lift it above any pin it would cover.
      const w = el.offsetWidth || 130;
      let y = pt.y;
      for (let pass = 0; pass < 3; pass++) {
        const hit = pins.some((p) => p.visible && Math.abs(p.x - pt.x) < w / 2 + HEAD / 2
          && (p.y - p.stem - HEAD) < y + 2 && (p.y - p.stem) > y - 30);
        if (!hit) break;
        y -= HEAD + 8;
      }
      el.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  // Outline of the hovered (or selected) event building, drawn at roof height and lifted 8% on hover.
  function drawOutline() {
    const target = ui.hoverId ?? ui.selectedId;
    const e = target ? model.byId.get(target) : null;
    const st = e && lastState?.ev.get(e.id);
    outlineSvg.replaceChildren();
    if (!e || !st?.vis || !e.buildingIds.length || !ui.layers.buildings) return;
    const lift = ui.hoverId ? 1.08 : 1;
    for (const id of e.buildingIds) {
      const b = buildings.get(id);
      for (const ring of b.rings) {
        const roof = ring.map((ll) => api.screenAt(ll, b.h * lift));
        const base = ring.map((ll) => api.screenAt(ll, 0));
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let d = `M${roof.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`;
        for (let i = 0; i < roof.length; i += Math.max(1, Math.floor(roof.length / 12))) {
          d += `M${roof[i].x.toFixed(1)},${roof[i].y.toFixed(1)}L${base[i].x.toFixed(1)},${base[i].y.toFixed(1)}`;
        }
        path.setAttribute('d', d);
        path.setAttribute('class', `outline ${e.type === 'incident' || e.type === 'closure' ? 'is-coral' : ''}`);
        outlineSvg.append(path);
      }
    }
  }

  api.map.on('render', reposition);

  return {
    update,
    reposition,
    /** The free map area as map padding ({ top, bottom, left, right }), from main.js. */
    setFreeArea(pad) { freeArea = pad; reposition(); },
    focusPin(id) {
      pins.find((p) => p.e.id === id)?.el.focus({ preventScroll: true });
    },
  };
}

const fmt = (n) => (n >= 1000 ? `${(Math.round(n / 50) * 50).toLocaleString('en-GB')}` : `${Math.round(n / 10) * 10}`);
