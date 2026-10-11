// Story time is represented as minutes since local midnight of the story date
// (values above 1440 mean "after midnight"). Everything on the map is derived from it.

/**
 * Accepts "HH:MM", "HH:MM:SS" or a full ISO timestamp with offset.
 * ISO values are converted to wall-clock time in the story's timezone.
 */
export function parseStoryTime(value, story) {
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  const clock = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  let minutes;
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] ?? 0) / 60;
  } else {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error(`Unrecognised time "${value}"`);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: story?.timezone ?? 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    minutes = get('hour') * 60 + get('minute') + get('second') / 60;
  }
  // A story that runs past midnight: early-morning times belong to the next day.
  const startClock = story?.start && /^\d/.test(story.start) ? clockToMinutes(story.start) : null;
  if (startClock != null && minutes < startClock - 6 * 60) minutes += 1440;
  return minutes;
}

const clockToMinutes = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

export function fmtClock(minutes) {
  const m = Math.floor(((minutes % 1440) + 1440) % 1440 + 1e-6);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtRange(start, end) {
  return end > start + 0.5 ? `${fmtClock(start)}–${fmtClock(end)}` : fmtClock(start);
}

export function fmtDuration(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "Friday 18 September 2026" in the story's own timezone. */
export function fmtStoryDate(story, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  const d = new Date(`${story.date}T12:00:00`);
  return new Intl.DateTimeFormat('en-GB', opts).format(d);
}

/** Short zone label, e.g. "CEST", for the date of the story. */
export function zoneLabel(story) {
  try {
    const d = new Date(`${story.date}T20:00:00Z`);
    const part = new Intl.DateTimeFormat('en-GB', { timeZone: story.timezone, timeZoneName: 'short' })
      .formatToParts(d).find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}
