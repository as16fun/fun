// Long-form Markdown → HTML for case studies. Supports what the case studies use:
// headings, paragraphs, lists, tables, block quotes, figures and galleries, links, bold,
// italic and code — plus a few editorial patterns:
//   **3.1/5 · 10 participants**     → a score bar measured against the 4/5 benchmark
//   **The decision:** …             → a decision callout
//   **What changed:** …             → a smaller "what changed" note
//   a whole paragraph in **bold**   → a short label, or a statement when it is long
//   [VISUAL — …]                    → a clearly marked "visual to come" slot
//   two-column tables               → facts (empty header) or metric cards
//   ::: timeline … :::              → a process timeline, one "- **Step** — text" line per step
//   ::: launch image.jpg … :::      → a launch card: image, "**Title** — text" and a [link](url)
//   ## 01 — Title {Kicker}           → a chapter whose label row names it by its kicker
//   ### 01 · Stage {Goal: …}         → a numbered stage head with its goal on the right
//   ::: prototype | tags | sphere | rotation | numbers | insights | question | next | principles |
//       directions | data | model | features | shot | rotate | growth | try   → the richer case-study blocks
// All text is escaped before formatting, so the file cannot inject HTML.
import { ICONS } from '../ui/icons.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u) => (/^(https?:|mailto:)/i.test(u) || /^[\w./#?=&%-]+$/.test(u) ? u : '#');
export const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function inline(text, base) {
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const url = safeUrl(href);
      const external = /^https?:/i.test(url);
      return `<a href="${url}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
    })
    // Anything still in [square brackets] is a placeholder for the author to fill in.
    .replace(/\[([^\]]+)\]/g, '<span class="ph" title="Placeholder — edit case-study.md">$1</span>')
    .replace(/`([^`]+)`/g, (_, code) => {
      const swatch = /^#[0-9a-f]{6}$/i.test(code) ? `<i class="cs-swatch" style="background:${code}"></i>` : '';
      return `<code>${swatch}${code}</code>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(\(→\))/g, '<span class="cs-arrow" aria-hidden="true">→</span>');
}

function figure(line, base) {
  const m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/);
  if (!m) return null;
  const [, alt, src, cap] = m;
  const url = /^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : `${base}${src}`;
  return `<figure class="cs-figure"><img src="${safeUrl(url)}" alt="${esc(alt)}" loading="lazy" decoding="async">${cap ? `<figcaption>${inline(cap, base)}</figcaption>` : ''}</figure>`;
}

function table(rows, base) {
  const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const strip = (s) => s.replace(/^\*\*(.*)\*\*$/, '$1');
  if (head.length === 2 && head.every((h) => !h)) {
    return `<dl class="cs-facts">${body.map(([k, v]) => `<div><dt>${inline(strip(k), base)}</dt><dd>${inline(v, base)}</dd></div>`).join('')}</dl>`;
  }
  if (head.length === 2) {
    return `<div class="cs-metrics" role="list">${body.map(([k, v]) => {
      const m = v.match(/^([−+-]?[\d.,]+[MK%]?\+?)(?:\s+(.*))?$/);
      const value = m ? `<strong class="cs-metric-value">${esc(m[1])}</strong>${m[2] ? `<span class="cs-metric-text">${inline(m[2], base)}</span>` : ''}` : `<span class="cs-metric-text is-only">${inline(v, base)}</span>`;
      return `<div class="cs-metric" role="listitem"><span class="cs-metric-label">${inline(strip(k), base)}</span>${value}</div>`;
    }).join('')}</div>`;
  }
  return `<div class="cs-table-wrap"><table><thead><tr>${head.map((h) => `<th>${inline(h, base)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c, base)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function paragraph(text, base) {
  const t = text.trim();
  const score = t.match(/^\*\*(\d+(?:\.\d+)?)\/(\d+)\s*·\s*(.+?)\*\*$/);
  if (score) {
    const v = Number(score[1]) / Number(score[2]);
    const pass = Number(score[1]) >= 4;
    return `<div class="cs-score${pass ? ' is-pass' : ''}"><span class="cs-score-value">${esc(score[1])}<small>/${esc(score[2])}</small></span><span class="cs-score-meta">${esc(score[3])}${pass ? ' · above the 4/5 benchmark' : ' · below the 4/5 benchmark'}</span><span class="cs-score-bar" role="img" aria-label="Score ${esc(score[1])} out of ${esc(score[2])}; benchmark 4"><i style="--v:${v.toFixed(3)}"></i><b style="--b:${(4 / Number(score[2])).toFixed(3)}"></b></span></div>`;
  }
  if (/^\[[^\]]+\]\([^)\s]+\)$/.test(t)) return `<p class="cs-cta">${inline(t, base)}</p>`;
  if (/^\*\*The decision:\*\*/.test(t)) return `<p class="cs-decision">${inline(t, base)}</p>`;
  if (/^\*\*What changed:\*\*/.test(t)) return `<p class="cs-changed">${inline(t, base)}</p>`;
  if (/^\*\*Press coverage:\*\*/.test(t)) return `<p class="cs-press">${inline(t, base)}</p>`;
  if (/^\*\*[^*]+\*\*$/.test(t)) {
    return t.length < 48 ? `<p class="cs-label">${inline(t, base)}</p>` : `<p class="cs-statement">${inline(t, base)}</p>`;
  }
  return `<p>${inline(t, base)}</p>`;
}

/** Fenced blocks (`::: kind arg` … `:::`) for the richer patterns. */
function block(kind, arg, body, base) {
  const lines = body.map((l) => l.trim()).filter(Boolean);
  const headed = (l) => l.match(/^(?:[-*]\s+)?\*\*(.+?)\*\*\s*[—-]\s*(.+)$/);
  if (kind === 'timeline') {
    const steps = lines.map(headed).filter(Boolean);
    return `<ol class="cs-timeline" style="--n:${steps.length}">${steps.map(([, label, text], k) =>
      `<li style="--i:${k}"><span class="cs-timeline-dot" aria-hidden="true">${k + 1}</span><strong>${inline(label, base)}</strong><span>${inline(text, base)}</span></li>`).join('')}</ol>`;
  }
  if (kind === 'launch') {
    const head = lines.map(headed).find(Boolean);
    const link = lines.map((l) => l.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)).find(Boolean);
    const note = lines.find((l) => /^_.+_$/.test(l));
    return `<div class="cs-launch">${arg ? `<div class="cs-launch-media"><img src="${safeUrl(`${base}${arg}`)}" alt="" loading="lazy" decoding="async"></div>` : ''}<div class="cs-launch-body">${
      head ? `<p class="cs-launch-title">${inline(head[1], base)}</p><p class="cs-launch-text">${inline(head[2], base)}</p>` : ''}${
      link ? `<a class="cs-launch-btn" href="${safeUrl(link[2])}">${esc(link[1])}${ICONS.arrowUpRight}</a>` : ''}${
      note ? `<p class="cs-launch-note">${inline(note.slice(1, -1), base)}</p>` : ''}</div></div>`;
  }
  const rich = richBlock(kind, arg, lines, base);
  if (rich !== null) return rich;
  return lines.length ? paragraph(lines.join(' '), base) : '';
}

// ── Richer blocks ─────────────────────────────────────────────────────────────
const SEP = /\s+—\s+/;
const pad2 = (n) => String(n).padStart(2, '0');
const boldLead = (s) => s.match(/^\*\*(.+?)\*\*\s*(.*)$/);
const afterDash = (s) => s.replace(/^—\s*/, '');
const keyLine = (lines, key) => {
  const l = lines.find((x) => x.startsWith(`${key}:`));
  return l ? l.slice(key.length + 1).trim() : null;
};
const items = (lines) => lines.filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, ''));
const picture = (src, alt, base, attrs = '') => `<img src="${safeUrl(`${base}${src}`)}" alt="${esc(alt)}" loading="lazy" decoding="async"${attrs}>`;
const BRAIN = '<svg width="22" height="22" viewBox="0 0 18 18" aria-hidden="true"><g fill="currentColor"><circle cx="16" cy="9" r="1.3"/><circle cx="13.95" cy="13.95" r="1.3"/><circle cx="9" cy="16" r="1.3"/><circle cx="4.05" cy="13.95" r="1.3"/><circle cx="2" cy="9" r="1.3"/><circle cx="4.05" cy="4.05" r="1.3"/><circle cx="9" cy="2" r="1.3"/><circle cx="13.95" cy="4.05" r="1.3"/><circle cx="9" cy="9" r="1.6"/></g></svg>';
const PERSON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="3.6" r="2.1" stroke="currentColor" stroke-width="1.2"/><path d="M1.8 10.8c.6-2.2 2.2-3.4 4.2-3.4s3.6 1.2 4.2 3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const CHECK = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.2l2.2 2.2 4.8-4.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const AGENT_DOTS = { strategist: '#6366f1', 'project manager': '#02b8cc', creative: '#27a644', 'brand owner': '#f2994a', 'brand brain': '#84e024' };

function richBlock(kind, arg, lines, base) {
  const label = (text) => (arg ? ` aria-label="${esc(text)}"` : '');
  switch (kind) {
    // a link to the prototype and a short note, under the standfirst
    case 'prototype': {
      const [text, note] = lines;
      return `<p class="cs-proto"><a class="cs-proto-btn" href="${safeUrl(arg)}" target="_blank" rel="noopener">${inline(text ?? '', base)}${ICONS.arrowUpRight}</a>${note ? `<span class="cs-proto-note">${inline(note, base)}</span>` : ''}</p>`;
    }
    case 'tags':
      return `<ul class="cs-tags">${items(lines).map((t) => `<li>${inline(t, base)}</li>`).join('')}</ul>`;
    // an interactive sphere of work tiles (drawn by sphere.js)
    case 'sphere': {
      const tiles = lines.filter((l) => l.startsWith('tile:')).map((l) => safeUrl(l.slice(5).trim())).filter((u) => u !== '#');
      const sprite = keyLine(lines, 'sprite');
      const hint = keyLine(lines, 'hint');
      const cap = keyLine(lines, 'caption');
      return `<figure class="cs-figure cs-sphere"${label(arg)}><div class="cs-sphere-stage" data-sprite="${sprite ? safeUrl(`${base}${sprite}`) : ''}" data-tiles="${esc(tiles.join(' '))}"><canvas class="cs-sphere-canvas" aria-hidden="true"></canvas><div class="cs-sphere-core"><span class="cs-sphere-icon">${BRAIN}</span><b>${inline(keyLine(lines, 'title') ?? '', base)}</b><span>${inline(keyLine(lines, 'text') ?? '', base)}</span></div>${hint ? `<span class="cs-sphere-hint" aria-hidden="true">${inline(hint, base)}</span>` : ''}</div>${cap ? `<figcaption>${inline(cap, base)}</figcaption>` : ''}</figure>`;
    }
    // teams in a row, joined by labelled arrows: "- **Team** — state [— note]" or "- arrow label"
    case 'rotation': {
      let team = 0;
      const cells = items(lines).map((t) => {
        const b = boldLead(t);
        if (!b) return `<div class="cs-rot-arrow" aria-hidden="true"><span>${inline(t, base)}</span></div>`;
        const [state, note] = afterDash(b[2]).split(SEP);
        const cls = note ? 'is-owner' : team++ === 0 ? 'is-full' : 'is-lost';
        return `<div class="cs-rot-team ${cls}"><span class="cs-rot-label">${inline(b[1], base)}</span><b>${inline(state ?? '', base)}</b>${note ? `<span class="cs-rot-repeat" aria-hidden="true">${inline(note, base)}</span>` : '<span class="cs-rot-bar" aria-hidden="true"><i></i></span>'}</div>`;
      });
      return `<figure class="cs-rot"${label(arg)}><div class="cs-rot-row">${cells.join('')}</div></figure>`;
    }
    // "- **32** people interviewed — who they were"
    case 'numbers':
      return `<div class="cs-numbers" role="list">${items(lines).map((t) => {
        const b = boldLead(t);
        if (!b) return '';
        const [what, sub] = b[2].split(SEP);
        return `<div class="cs-number" role="listitem"><b>${inline(b[1], base)}</b><span>${inline(what ?? '', base)}${sub ? `<small>${inline(sub, base)}</small>` : ''}</span></div>`;
      }).join('')}</div>`;
    // "- **Title** — text" cards, numbered "Insight 01" when the block names them
    case 'insights': {
      const cards = items(lines).map(boldLead).filter(Boolean);
      return `<div class="cs-insights${cards.length === 3 ? ' is-3' : ''}" role="list">${cards.map(([, title, rest], k) => `<div class="cs-insight" role="listitem">${arg ? `<p class="cs-insight-n">${esc(arg)} ${pad2(k + 1)}</p>` : ''}<h3>${inline(title, base)}</h3><p>${inline(afterDash(rest), base)}</p></div>`).join('')}</div>`;
    }
    case 'question':
      return `<div class="cs-chap-card cs-callout"><p class="cs-chap-card-label">${inline(arg, base)}</p><p class="cs-chap-card-text">${inline(lines.join(' '), base)}</p></div>`;
    case 'next':
      return `<div class="cs-decision-card cs-next"><p class="cs-decision-card-label">${inline(arg, base)}</p><p class="cs-decision-card-title">${inline(lines.join(' '), base)}</p></div>`;
    // numbered chips; "text — tag" marks one added later
    case 'principles':
      return `<ol class="cs-principles">${items(lines).map((t, k) => {
        const [text, tag] = t.split(SEP);
        return `<li${tag ? ' class="is-later"' : ''}><i>${pad2(k + 1)}</i>${inline(text, base)}${tag ? ` <span class="cs-tag-new">${inline(tag, base)}</span>` : ''}</li>`;
      }).join('')}</ol>`;
    // options as columns, criteria as rows of dots out of three; "Chosen" marks the winner
    case 'directions': {
      const dirs = items(lines).map(boldLead).filter(Boolean).map(([, name, rest]) => {
        const [tag, desc, verdict] = afterDash(rest).split(SEP);
        return { name, tag, desc, verdict, chosen: /^chosen$/i.test(verdict ?? '') };
      });
      const rows = lines.filter((l) => /^[^-*_+].*:\s*[\d\s]+$/.test(l)).map((l) => {
        const i = l.lastIndexOf(':');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().split(/\s+/).map(Number)];
      });
      const note = lines.find((l) => /^_.+_$/.test(l));
      const dots = (v) => `<span class="cs-dots" role="img" aria-label="${v} of 3">${[0, 1, 2].map((k) => `<i${k < v ? ' class="on"' : ''}></i>`).join('')}</span>`;
      return `<div class="cs-dirs-wrap"><div class="cs-dirs" role="table"${label(arg)}><div class="cs-dirs-head" role="row"><span role="columnheader"></span>${dirs.map((d) => `<div class="cs-dir${d.chosen ? ' is-chosen' : ''}" role="columnheader"><i>${inline(d.tag ?? '', base)}</i><b>${inline(d.name, base)}</b>${d.desc ? `<small>${inline(d.desc, base)}</small>` : ''}${d.verdict ? `<em>${inline(d.verdict, base)}</em>` : ''}</div>`).join('')}</div>${rows.map(([name, vals]) => `<div class="cs-dirs-row" role="row"><span class="cs-dirs-c" role="rowheader">${inline(name, base)}</span>${vals.map((v, k) => `<span class="cs-dirs-v${dirs[k]?.chosen ? ' is-chosen' : ''}" role="cell">${dots(v)}</span>`).join('')}</div>`).join('')}</div>${note ? `<p class="cs-dirs-note">${inline(note.slice(1, -1), base)}</p>` : ''}</div>`;
    }
    // "- good **82%** — what it measured", "- bad **1 in 3** — …"; "**A → B**" shows where it started
    case 'data': {
      const cells = items(lines).map((t) => {
        const m = t.match(/^(good|bad)?\s*\*\*(.+?)\*\*\s*—\s*(.+)$/);
        if (!m) return '';
        const [from, to] = m[2].includes('→') ? m[2].split(/\s*→\s*/) : [null, m[2]];
        return `<div class="cs-data-item${m[1] ? ` is-${m[1]}` : ''}"><b>${from ? `<small>${esc(from)} →</small>` : ''}${esc(to)}</b><span>${inline(m[3], base)}</span></div>`;
      }).join('');
      const so = lines.find((l) => !/^[-*]\s/.test(l));
      return `<div class="cs-data"><p class="cs-data-h">${inline(arg, base)}</p><div class="cs-data-grid">${cells}</div>${so ? `<p class="cs-data-so">${inline(so, base)}</p>` : ''}</div>`;
    }
    // one step per agent: "- **Stage** — Agent — question — what the person does"
    case 'model': {
      const steps = items(lines).map(boldLead).filter(Boolean).map(([, stage, rest]) => {
        const [agent, quote, gate] = afterDash(rest).split(SEP);
        return { stage, agent: agent ?? '', quote, gate };
      });
      const legend = keyLine(lines, 'legend')?.split(SEP) ?? [];
      const memory = keyLine(lines, 'memory')?.split(SEP) ?? [];
      return `<figure class="cs-model"><div class="cs-model-head"><span class="cs-model-title">${inline(arg, base)}</span>${legend.length ? `<div class="cs-model-legend" aria-hidden="true"><span><i class="l-agent"></i>${inline(legend[0], base)}</span><span><i class="l-human"></i>${inline(legend[1] ?? '', base)}</span></div>` : ''}</div><ol class="cs-model-steps">${steps.map((st, k) => {
        const brain = /brand brain/i.test(st.agent);
        return `<li class="cs-model-step${brain ? ' is-brain' : ''}"><div class="cs-model-stage"><i>${pad2(k + 1)}</i>${inline(st.stage, base)}</div><div class="cs-model-agent"><b><span class="cs-adot" style="--dot:${AGENT_DOTS[st.agent.toLowerCase()] ?? '#8a948c'}"></span>${inline(st.agent, base)}</b>${st.quote ? `<p>${inline(st.quote, base)}</p>` : ''}</div>${st.gate ? `<div class="cs-model-gate${brain ? ' is-quiet' : ''}">${brain ? CHECK : PERSON}<span>${inline(st.gate, base)}</span></div>` : ''}</li>`;
      }).join('')}</ol>${memory.length ? `<div class="cs-model-memory"><b>${BRAIN}${inline(memory[0], base)}</b>${memory[1] ? `<div class="cs-model-chips">${memory[1].split(/,\s*/).map((c) => `<span>${inline(c, base)}</span>`).join('')}</div>` : ''}${memory[2] ? `<small>${inline(memory[2], base)}</small>` : ''}</div>` : ''}</figure>`;
    }
    case 'features': {
      const cards = items(lines).map(boldLead).filter(Boolean);
      return `<div class="cs-features${cards.length === 3 ? ' is-3' : ''}" role="list">${cards.map(([, title, rest]) => `<div class="cs-feature" role="listitem"><h4>${inline(title, base)}</h4><p>${inline(afterDash(rest), base)}</p></div>`).join('')}</div>`;
    }
    // a screenshot with numbered pins ("- x y note", in % of the image) and its notes, under it or
    // beside it ("side"); "sketch" puts a drawn interface on a stage; "+ image — caption — alt" adds images below
    case 'shot': {
      const [src, mode] = arg.split(/\s+/);
      const side = mode === 'side';
      const sketch = mode === 'sketch'; // a drawn interface, shown on a tinted stage
      const alt = keyLine(lines, 'alt') ?? '';
      const cap = keyLine(lines, 'caption');
      const intro = keyLine(lines, 'intro');
      const notes = items(lines).map((t) => {
        const m = t.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(.+)$/);
        const body = m ? m[3] : t;
        const b = boldLead(body);
        return { x: m?.[1], y: m?.[2], title: b ? b[1] : null, text: b ? afterDash(b[2]) : body };
      });
      const extras = lines.filter((l) => /^\+\s+/.test(l)).map((l) => l.replace(/^\+\s+/, '').split(SEP));
      const pins = notes.map((n, k) => (n.x ? `<span class="cs-pin" data-pin="${k + 1}" style="--x:${n.x}%;--y:${n.y}%" aria-hidden="true">${k + 1}</span>` : '')).join('');
      const list = notes.length ? `<ol class="cs-notes${side ? ' is-side' : ''}" style="--n:${Math.min(notes.length, 4)}">${notes.map((n, k) => `<li data-pin="${k + 1}"><span class="cs-pin" aria-hidden="true">${k + 1}</span>${side && n.title ? `<div><h4>${inline(n.title, base)}</h4><p>${inline(n.text, base)}</p></div>` : `<span>${n.title ? `<strong>${inline(n.title, base)}</strong> ` : ''}${inline(n.text, base)}</span>`}</li>`).join('')}</ol>` : '';
      const media = `<div class="cs-shot-media">${picture(src, alt, base)}${pins}</div>`;
      const more = extras.length ? `<div class="cs-gallery cs-gallery-${Math.min(extras.length, 3)}">${extras.map(([s, c, a]) => `<figure class="cs-figure">${picture(s, a ?? c ?? '', base)}${c ? `<figcaption>${inline(c, base)}</figcaption>` : ''}</figure>`).join('')}</div>` : '';
      return `<figure class="cs-figure cs-shot${side ? ' is-side' : ''}${sketch ? ' is-sketch' : ''}">${side ? `<div class="cs-shot-main">${media}<div class="cs-shot-side">${intro ? `<p class="cs-shot-intro">${inline(intro, base)}</p>` : ''}${list}</div></div>` : media}${cap ? `<figcaption>${inline(cap, base)}</figcaption>` : ''}${more}${side ? '' : list}</figure>`;
    }
    // images that take turns: "- image — alt"; the block's argument is the caption
    case 'rotate': {
      const pics = items(lines).map((t) => t.split(SEP));
      return `<figure class="cs-figure cs-rotate"><div class="cs-rotate-media" role="button" tabindex="0" aria-label="Enlarge image">${pics.map(([s, a], k) => picture(s, a ?? '', base, k === 0 ? ' class="is-on"' : '')).join('')}</div><div class="cs-rotate-dots" aria-hidden="true">${pics.map((_, k) => `<i${k === 0 ? ' class="is-on"' : ''}></i>`).join('')}</div>${arg ? `<figcaption>${inline(arg, base)}</figcaption>` : ''}</figure>`;
    }
    // "- **Step** — the moment that matters — what I designed", and the loop that closes it
    case 'growth': {
      const [l1, l2] = (keyLine(lines, 'labels') ?? '').split(SEP);
      const loop = keyLine(lines, 'loop');
      const steps = items(lines).map(boldLead).filter(Boolean).map(([, name, rest]) => [name, ...afterDash(rest).split(SEP)]);
      return `<figure class="cs-growth-wrap"><ol class="cs-growth"${label(arg)}>${steps.map(([name, moment, made], k) => `<li class="cs-gstep"><span class="cs-gnum">${pad2(k + 1)}</span><span class="cs-gname">${inline(name, base)}</span>${l1 ? `<span class="cs-glabel">${inline(l1, base)}</span>` : ''}<span class="cs-gtext">${inline(moment ?? '', base)}</span>${l2 ? `<span class="cs-glabel">${inline(l2, base)}</span>` : ''}<span class="cs-gtext">${inline(made ?? '', base)}</span></li>`).join('')}</ol>${loop ? `<div class="cs-gloop" aria-hidden="true"><span>${inline(loop, base)}</span></div>` : ''}</figure>`;
    }
    // the invitation to the prototype: label, title, text and the button
    case 'try': {
      const [kicker, title, text, button] = lines;
      return `<a class="cs-try" href="${safeUrl(arg)}" target="_blank" rel="noopener"><div><p class="cs-try-k">${inline(kicker ?? '', base)}</p><p class="cs-try-title">${inline(title ?? '', base)}</p>${text ? `<p class="cs-try-text">${inline(text, base)}</p>` : ''}</div>${button ? `<span class="cs-try-btn">${inline(button, base)}</span>` : ''}</a>`;
    }
    default:
      return null;
  }
}

/**
 * @returns {{ html: string, title: string, sections: {id: string, num: string, title: string}[] }}
 */
export function renderCaseStudy(md, { base = '' } = {}) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const sections = [];
  let title = '';
  let para = [];
  let list = null;
  let figures = [];

  const flushPara = () => {
    if (para.length) out.push(paragraph(para.join(' '), base));
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type} class="cs-list">${list.items.map((i) => `<li>${inline(i, base)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushFigures = () => {
    if (figures.length === 1) out.push(figures[0]);
    else if (figures.length > 1) out.push(`<div class="cs-gallery cs-gallery-${Math.min(figures.length, 3)}">${figures.join('')}</div>`);
    figures = [];
  };
  const flush = () => { flushPara(); flushList(); flushFigures(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; } // a blank line ends a paragraph, list or gallery
    if (/^!\[/.test(line)) {
      flushPara(); flushList();
      const fig = figure(line, base);
      if (fig) { figures.push(fig); continue; }
    } else flushFigures();

    if ((m = line.match(/^:::\s*(\w+)\s*(.*)$/))) {
      flush();
      const body = [];
      while (i + 1 < lines.length && !/^:::\s*$/.test(lines[i + 1].trim())) body.push(lines[++i]);
      i++; // the closing :::
      out.push(block(m[1], m[2].trim(), body, base));
      continue;
    }
    if ((m = line.match(/^#\s+(.+)$/))) { flush(); title = m[1].trim(); out.push(`<h1 class="cs-title">${inline(title, base)}</h1>`); continue; }
    if ((m = line.match(/^##\s+(.+)$/))) {
      flush();
      const full = m[1].trim();
      const km = full.match(/^(.*?)\s*\{([^}]+)\}$/); // "Title {Kicker}"
      const raw = km ? km[1] : full;
      const kicker = km ? km[2].trim() : '';
      const nm = raw.match(/^(\d{2})\s*—\s*(.+)$/);
      const id = slug(kicker || (nm ? nm[2] : raw));
      sections.push({ id, num: nm ? nm[1] : '', title: nm ? nm[2] : raw });
      out.push(`<h2 class="cs-h2" id="${id}"${kicker ? ` data-kicker="${esc(kicker)}"` : ''}>${nm ? `<span class="cs-h2-num">${nm[1]}</span>` : ''}<span>${inline(nm ? nm[2] : raw, base)}</span></h2>`);
      continue;
    }
    if ((m = line.match(/^###\s+(\d{2})\s*·\s*(.+?)(?:\s*\{([^}]+)\})?$/))) {
      flush();
      out.push(`<h3 class="cs-stage" id="${slug(m[2])}"><span class="cs-stage-num">${m[1]}</span><span class="cs-stage-title">${inline(m[2], base)}</span>${m[3] ? `<span class="cs-stage-goal">${inline(m[3], base)}</span>` : ''}</h3>`);
      continue;
    }
    if ((m = line.match(/^###\s+(.+)$/))) {
      flush();
      const raw = m[1].trim();
      const nm = raw.match(/^(\d+)\.\s+(.+)$/);
      out.push(`<h3 class="cs-h3" id="${slug(raw)}">${nm ? `<span class="cs-h3-num">${nm[1].padStart(2, '0')}</span>` : ''}<span>${inline(nm ? nm[2] : raw, base)}</span></h3>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {
      flush();
      const rows = [line];
      while (i + 1 < lines.length && /^\|.*\|\s*$/.test(lines[i + 1].trim())) rows.push(lines[++i].trim());
      out.push(table(rows, base));
      continue;
    }
    if ((m = line.match(/^\[VISUAL\s*[—-]\s*(.+)\]$/))) {
      flush();
      out.push(`<div class="cs-todo" role="note"><span class="cs-todo-badge">Visual to come</span><p>${inline(m[1], base)}</p></div>`);
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { flush(); out.push(`<blockquote>${inline(m[1], base)}</blockquote>`); continue; }
    if ((m = line.match(/^[-*]\s+(.+)$/))) { flushPara(); if (list?.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\d+[.)]\s+(.+)$/))) { flushPara(); if (list?.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList();
    para.push(line.trim());
  }
  flush();
  return { html: out.join('\n'), title, sections };
}
