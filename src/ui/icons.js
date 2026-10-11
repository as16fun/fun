// Inline SVG icons (24×24, 1.75 stroke) and the confidence glyphs.
const svg = (body, { size = 20, fill = 'none', sw = 1.75, cls = '' } = {}) =>
  `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="7" y="5.5" width="3.6" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1" fill="currentColor" stroke="none"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  target: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>'),
  layers: svg('<path d="m12 3.5 8.5 4.6L12 12.7 3.5 8.1z"/><path d="m3.5 12.1 8.5 4.6 8.5-4.6"/><path d="m3.5 16 8.5 4.5 8.5-4.5"/>'),
  share: svg('<path d="M12 15V3.8M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v5.7A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8v-5.7"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevronLeft: svg('<path d="m14.5 6-6 6 6 6"/>'),
  chevronRight: svg('<path d="m9.5 6 6 6-6 6"/>'),
  chevronDown: svg('<path d="m6 9.5 6 6 6-6"/>'),
  arrowDown: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  arrowUpRight: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
  arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.3A1.8 1.8 0 0 0 13.7 4.5H6.3A1.8 1.8 0 0 0 4.5 6.3v7.4a1.8 1.8 0 0 0 1.8 1.8h2.2"/>'),
  code: svg('<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4"/>'),
  keyboard: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
  book: svg('<path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h12.5v14H6a1.5 1.5 0 0 0-1.5 1.5z"/><path d="M4.5 19.5A1.5 1.5 0 0 0 6 21h12.5v-3"/>'),
  sparkle: svg('<path d="M12 3.5 13.6 9l5.4 1.5-5.4 1.6L12 17.5l-1.6-5.4L5 10.5 10.4 9z"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  scroll: svg('<rect x="7" y="3.5" width="10" height="17" rx="5"/><path d="M12 7.5v3"/>'),
  compass: svg('<circle cx="12" cy="12" r="8.5"/><path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z"/>'),
  external: svg('<path d="M13.5 4.5h6v6M19.5 4.5l-8 8"/><path d="M18 14v4.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2V7.8A1.8 1.8 0 0 1 5.8 6H10"/>'),
  // places on the journey
  cap: svg('<path d="M2.75 9.25 12 5l9.25 4.25L12 13.5z"/><path d="M6.5 11.25v4.25c0 1.4 2.46 2.75 5.5 2.75s5.5-1.35 5.5-2.75v-4.25"/><path d="M21.25 9.25v5.25"/>'),
  tower: svg('<rect x="6.5" y="3" width="11" height="17.5" rx="1.5"/><path d="M9.75 7h1M13.25 7h1M9.75 10.5h1M13.25 10.5h1M9.75 14h1M13.25 14h1M10.5 20.5v-2.75h3v2.75M3.5 20.5h17"/>'),
  laptop: svg('<rect x="4.75" y="5.25" width="14.5" height="10" rx="1.5"/><path d="M2.75 18.75h18.5"/>'),
  // event types
  gathering: svg('<circle cx="8" cy="9" r="2.5"/><circle cx="16" cy="9" r="2.5"/><path d="M3.5 18.5c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M11.5 18.5c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4"/>'),
  movement: svg('<path d="M4 18c3.5 0 4-12 8-12s4.5 12 8 12"/><path d="m17 15 3 3-3 3"/>'),
  closure: svg('<rect x="3.5" y="8.5" width="17" height="6" rx="1.2"/><path d="m7 8.5-3 6M12.5 8.5l-3 6M18 8.5l-3 6M6 14.5V19M18 14.5V19"/>'),
  transport: svg('<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 11h12M9 20l-1.5 1.5M15 20l1.5 1.5M9 16.5 7.5 20M15 16.5l1.5 3.5"/><path d="M9.5 14h.01M14.5 14h.01"/>'),
  statement: svg('<path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>'),
  incident: svg('<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17h.01"/>'),
  // source types
  reporter: svg('<path d="M5 19.5V6.8A2.3 2.3 0 0 1 7.3 4.5h9.4A2.3 2.3 0 0 1 19 6.8v12.7l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path d="M8.5 9h7M8.5 12.5h5"/>'),
  photo: svg('<rect x="3.5" y="6.5" width="17" height="12.5" rx="2"/><circle cx="12" cy="12.7" r="3.2"/><path d="M8.5 6.5 10 4.5h4l1.5 2"/>'),
  video: svg('<rect x="3.5" y="6.5" width="12.5" height="11" rx="2"/><path d="m16 10.5 4.5-2.5v8l-4.5-2.5"/>'),
  data: svg('<path d="M4 19.5h16M7 16.5V11M12 16.5V6.5M17 16.5v-4"/>'),
  official: svg('<path d="M4 9.5 12 4.5l8 5M5.5 9.5v8M18.5 9.5v8M9.5 9.5v8M14.5 9.5v8M4 19.5h16"/>'),
  organiser: svg('<path d="M4 10v4h3l6 4V6L7 10z"/>'),
  organisation: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M7.5 12h9"/>'),
  eyewitness: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  social: svg('<path d="M5 18.5V8a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 8v6a2.5 2.5 0 0 1-2.5 2.5H9z"/><path d="M9 10.5h6M9 13h3.5"/>'),
};

// Confidence glyphs: never rely on colour alone.
export const GLYPHS = {
  confirmed: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.3 5 8.6l4.4-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  reported: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 7.6c0-2.3 1-3.6 2.7-4.2l.4.8c-.9.5-1.4 1.2-1.5 2h1.5v2.9H2.4zM6.7 7.6c0-2.3 1-3.6 2.7-4.2l.4.8c-.9.5-1.4 1.2-1.5 2h1.5v2.9H6.7z" fill="currentColor"/></svg>',
  unverified: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.1 4.5a2 2 0 1 1 2.8 1.8c-.6.3-.9.7-.9 1.3v.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="6" cy="9.9" r=".95" fill="currentColor"/></svg>',
  disputed: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.6h7M2.5 7.6h7M7.6 2.4 4.4 9.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
