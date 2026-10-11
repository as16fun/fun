// Visual and behavioural constants shared by the map and the UI.

export const COLORS = {
  bg: '#F2F4F7',
  ground: '#F2F4F7',
  clay: '#F8F9FB',
  clayFar: '#F2F4F7',
  road: '#E1E4E9',
  roadMinor: '#E8EAEE',
  square: '#E9EBEF',
  rail: '#CDD2DA',
  water: '#C9D3DF',
  waterEdge: '#B6C2D0',
  green: '#E0E9DA',
  tree: '#DCE6D6',
  trunk: '#D3CDC5',
  ink: '#0E1220',
  blue: '#3B5BFF',
  blueTint: '#7F95FF',
  blueSoft: '#C9D3FF',
  coral: '#E5646E',
  coralTint: '#EE959C',
  amber: '#E9A23B',
  amberTint: '#F2C47F',
};

export const CONFIDENCE = {
  confirmed: {
    label: 'Confirmed',
    color: COLORS.blue,
    short: 'Verified by at least two independent sources, including direct observation or geolocated media.',
  },
  reported: {
    label: 'Reported',
    color: '#5873FF',
    short: 'From a credible source, but not yet independently verified.',
  },
  unverified: {
    label: 'Unverified',
    color: COLORS.amber,
    short: 'A circulating claim we could not verify. Treat with caution.',
  },
  disputed: {
    label: 'Disputed',
    color: COLORS.amber, // same as unverified; the split and the ≠ glyph tell them apart
    short: 'Sources disagree on key facts. The competing accounts are shown.',
  },
};

export const EVENT_TYPES = {
  gathering: 'Gathering',
  movement: 'Movement',
  closure: 'Closure',
  transport: 'Transport',
  statement: 'Statement',
  incident: 'Incident',
};

export const SOURCE_TYPES = {
  reporter: 'Reporter',
  photo: 'Photo',
  video: 'Video',
  data: 'Data feed',
  official: 'Official',
  organiser: 'Organiser',
  organisation: 'Organisation',
  eyewitness: 'Eyewitness',
  social: 'Social media',
};

export const CAMERA = {
  zoom: 16.15,
  minZoom: 15.35,
  maxZoom: 19.4,
  pitch: 50, // MapLibre pitch is measured from straight down: 50° ≈ 40° elevation
  minPitch: 42,
  maxPitch: 58,
  bearing: -30,
  bearingRange: 28, // ± degrees around the default
  fov: 16, // narrow field of view keeps the city close to an isometric look
};

export const PLAYBACK = {
  minutesPerSecond: 1, // 1× plays one story-minute per second
  speeds: [4, 16],
};

// People represented by one crowd column (≈1.3 people per m² on a 3.4 m hex).
export const CROWD = { peoplePerColumn: 40, hexRadius: 3.4 };

export const BREAKPOINT = 768;
