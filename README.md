# Design journey + Storyline

This repo holds two pages built on the same clay-map engine:

- **`index.html`: the design journey.** A scroll-driven 3D map of a designer's route:
  - Macerata: the Accademia di Belle Arti, bachelor's and master's in Graphic & UI Design, and freelance work
  - Eindhoven: the Eindhoven Tower, Mapcreator, solo designer to lead of four
  - Den Haag: remote for Superside, Senior to Lead
- **`dispatch.html`: Storyline**, the newsroom story-map concept described below.

## The journey page

### Editing the text

All the copy lives in [`public/journey/journey.json`](public/journey/journey.json): name, role, chapter text, stats, places, camera angles and the closing call to action. No code changes are needed.

- **Placeholders:** text in `[square brackets]` is a placeholder. It shows up amber on the page until you replace it.
- **`period`:** optional. Fill it in (e.g. `"2018 – 2022"`) and it appears as a chip next to the tag.
- **Places:**
  - `place.buildingIds` picks the highlighted building, using OSM ids from that city's `buildings.geojson`.
  - `"marker": "city"` shows a floating city badge instead of pinning a building. Den Haag uses it because that work was remote.
  - `place.icon` picks the place's icon from [`src/ui/icons.js`](src/ui/icons.js): `cap` (the academy), `tower` (the Eindhoven Tower), `laptop` (remote).
- **Contact:** "Contact" and "Get in touch" use `person.email` once it's filled in. Until then they open the first profile link (LinkedIn) in a new tab.
- **Case studies:** `caseStudies` on a stop adds a "Check case studies" card under its card. The Mapcreator stop lists the story maps (2022) first, then the US election map (2020). The Superside stop lists Brand Brain (2026).
  - The card shows each one's title, `year` and a "Read the case study" link. Without a `url`, it shows "Case study coming soon".
  - `tag`, `summary`, `image` and `demo` appear in the "More case studies" footer of the other case studies.

### Case studies

Each case study is a page plus a Markdown file, with its images in the same folder:

- **Designing the live 2020 US election map for newsrooms:** page `case-studies/us-election-2020/index.html`, text `public/case-studies/us-election-2020/case-study.md`.
- **Designing 3D story maps for newsrooms:** page `case-studies/story-maps/index.html`, text `public/case-studies/story-maps/case-study.md`. Its screenshots come from the Storyline concept, an openly labelled recreation, because the original newsroom stories and customers are confidential.
- **Turning project management into a brand brain (multi-agents platform):** page `case-studies/brand-brain/index.html`, text `public/case-studies/brand-brain/case-study.md`. Its prototype, `public/case-studies/brand-brain/prototype.html`, is copied unchanged and opens in a new tab.
- **Editing:** edit the Markdown and reload; no code changes needed.
- **Images:** every image opens full size in a lightbox. Click anywhere or press Esc to close it.
- **Writing conventions:**
  - **Images:** `![alt](file.jpg "caption")` makes a figure. Images on consecutive lines form a gallery.
  - **Scores:** `**4.3/5 · 10 participants**` becomes a score bar against the 4/5 benchmark.
  - **Callouts:** paragraphs starting with `**The decision:**` or `**What changed:**` become callouts.
  - **Missing visuals:** `[VISUAL — description]` stays as a "Visual to come" slot until you swap in an image.
  - **Timeline:** a `::: timeline` block, with one `- **Step** — text` line per step and a closing `:::`, becomes a process timeline that draws itself in.
  - **Launch card:** `::: launch image.jpg`, then `**Title** — text`, a `[label](url)` and an optional `_note_`, closed by `:::`, becomes a dark card that links to a prototype.
  - **Chapter kickers:** `## 01 — Title {Kicker}` names the chapter by its kicker in the label row. `### 01 · Stage {Goal: …}` makes a numbered stage head with its goal.
  - **More blocks** (used by Brand Brain, each a `::: name argument` … `:::` block): `prototype` and `tags` under the standfirst, `sphere` (the interactive hero), `rotation`, `numbers`, `insights`, `question`, `next`, `principles`, `directions`, `data`, `model`, `features`, `shot` (a screenshot with numbered pins and notes, `side` or `sketch`), `rotate` (images that take turns), `growth` and `try`. The line formats are described at the top of [`src/casestudy/render.js`](src/casestudy/render.js) and next to each block.
- **Page options** (attributes on `<body>` in the page's `index.html`):
  - `data-live` turns the hero image into a poster for a live embed: one click loads the URL in place. Phones open `data-live-full` instead.
  - `data-scrolly="section-id"` turns that section's `###` ideas into scrollytelling: the text scrolls while a sticky frame shows each idea's images. Below 820 px it stays stacked.
  - The story-maps page uses both: the live Storyline embed in the hero, and the final prototype as scrollytelling.
- **Motion:** blocks rise in as they scroll into view, and the contents marker slides between sections. All of it is off with `prefers-reduced-motion`.
- **Adding another case study:**
  1. Copy the folder pair (page and content).
  2. Add the page to `build.rollupOptions.input` in `vite.config.js`.
  3. Set the card's `url` in `journey.json`.

### How it behaves

- **Loading:** the page opens on Italy, then the camera dives into Macerata while the city grows from the Academy outwards.
- **Scrolling:** each chapter flies the camera to the next city, drawing the route across Europe as it goes. Cities fade in as the camera descends and regrow each time you arrive.
- **Top bar:** "Case studies" opens the case studies page, [`case-studies/`](case-studies/index.html), which lists every `caseStudies` item from `journey.json` by `year`, most recent first. The same link sits in each case study's top bar.
- **Explore the map:** hands the camera to the reader. Esc or "Back to the story" returns.
- **Phones:** cards sit at the bottom and the map above. The map keeps its subject in the space above the card, so a tall card pulls the view up and out. With `prefers-reduced-motion`, flights become cuts.

### Data

```bash
npm run data:journey   # Macerata, Eindhoven and Den Haag districts (OSM) and the Europe base (Natural Earth)
npm run data -- --district macerata   # one district at a time: macerata | eindhoven | hague | storyline
npm run data:europe
```

- **Den Haag:** its district lives in `public/journey/den-haag/` (`--district hague`).
- **Europe base:** `public/journey/europe.geojson` holds Natural Earth 1:10m land, borders, lakes, rivers and urban areas, clipped to Europe. It is public domain.

---

# Storyline: a 3D story map for newsrooms

Storyline shows how an event unfolded across a city, in time and in space. A timeline drives everything: events appear as numbered pins, marches move along real streets, crowds grow and shrink, and road closures and bus diversions light up. Every event shows how well it is sourced.

The demo is set in central Eindhoven: it gathers on the Markt, marches up Demer and across 18 Septemberplein, comes down Stratumseind and ends on the Stadhuisplein in front of City Hall.

> **Fictional demo scenario.** The demonstration, times, crowd figures, quotes, people and sources are all invented. Only the street names and the map data are real (© OpenStreetMap contributors, ODbL).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (journey) · /dispatch.html (Storyline)
npm run build      # static site in dist/ (relative paths, works from any sub-folder)
npm run preview    # serve dist/
```

Node 20+ is required (built and tested with Node 24).

## Tech choices

- **MapLibre GL JS 6.11:** open source (BSD) and key-free. The style is built entirely from this project's own OSM GeoJSON: no basemap tiles, no glyphs, no API keys at runtime.
  - **Shadows:** MapLibre cannot cast shadows or do ambient occlusion. So the pipeline bakes soft sun shadows, contact shading and the edge fade into one georeferenced image (`data/lighting.png`), which sits under the 3D buildings.
  - **Camera:** MapLibre has no orthographic camera. A narrow 16° field of view, a 50° pitch and a −30° bearing give a near-isometric look.
  - **Camera limits:** zoom, pitch, bearing and pan are all clamped. Pan uses `transformConstrain`.
  - **Rooftop pins:** a tiny custom layer captures the projection matrix each frame, so the DOM pins can stand on rooftops.
  - **Dynamic layers:** they use `feature-state`, `line-gradient` and small GeoJSON updates, so nothing re-tiles the city while you scrub.
- **Vite 8:** ES modules with exact pinned versions, and the MapLibre web worker bundled correctly (`?worker&url`). Everything in `public/` ships as static files, and the build-time Node scripts live in the same repo. The Inter font is self-hosted through Fontsource, so there are no third-party requests at runtime.

## Data pipeline (build time only)

```bash
npm run data                                   # fetch central Eindhoven from the Overpass API (4 mirrors, retries)
npm run data:offline                           # re-process the cached response
npm run data -- --from-file my-osm-export.json # use your own Overpass/OSM JSON export
npm run snap-paths                             # route story waypoints along real streets or bus roads
```

`scripts/fetch-osm.mjs`:

1. **Fetch.** Gets buildings, roads, rail, water, green areas and trees for a ~1.25 × 1.25 km box around the ~800 × 800 m story district.
2. **Heights.** Uses the `height` tag, then `building:levels`, then a small seeded estimate (identical on every rebuild). The source of each height is recorded per building (`hs`).
3. **Projection.** Projects to local metres (equirectangular around the district centre) for all the maths: areas, heights, the district fade, the intro wave delay and the shadow bake. The GeoJSON is saved in **WGS84**, because MapLibre consumes lon/lat. The projection parameters are stored in `meta.json`.
4. **Lighting bake.** Bakes `lighting.png`, a pure-JS scanline fill, blur and PNG encoder with no native dependencies.
5. **Failure.** If every Overpass mirror fails, it says so plainly. It also tells you whether the servers answered but were busy, or whether the network blocks them. It writes nothing and never invents a substitute city.

Output in `public/data/`: `buildings`, `roads`, `rail`, `water`, `green` and `trees` (all `.geojson`), plus `lighting.png` and `meta.json`.

## Story format: `public/data/story.json`

One file drives the whole map, so a newsroom can swap in its own story. The full schema is in [`public/data/story.schema.json`](public/data/story.schema.json).

- **`story`:** `title`, `standfirst`, `byline`, `date`, `timezone`, `start`, `end`, `disclaimer`.
- **`chapters[]`:** `id`, `title`, `start`, `summary`, and `camera: { target: [lon, lat], zoom }`. The zoom is relative: 1 is the whole district, 2 is twice as close.
- **`sources[]`:** a registry of sources with `id`, `name`, `type`, `reliability` and `note`.
- **`events[]`:** each event has:
  - `id`, `time` (`"HH:MM"` or `{ start, end }`), `title`, `summary`, `type`, `place`
  - `type` is one of `gathering | movement | closure | transport | statement | incident`
  - `location`: a `point`, a `path`, several `paths`, or an `area` polygon, plus an optional `anchor` for the pin
  - `buildingId` / `buildingIds`: OSM ids from `buildings.geojson`
  - `crowd`: `{ estimate, low, high, series: [{ time, estimate, low, high }], claims: [...] }`
  - `confidence` (`confirmed | reported | unverified | disputed`) and `confidenceNote`
  - `quote`
  - `sources: [{ source, timestamp, detail, link }]`

Times interpolate. The map state at any time `t` comes from one pure function, `computeState(model, t)` in `src/story/state.js`. Scrubbing, playing, scrolling the story, deep links and keyboard steps all go through it.

**Authoring tip:** give a path location `"snap": "streets"` (or `"bus"` for roads a bus can drive, or `"tram"`) and a few `"via"` waypoints, then run `npm run snap-paths`. It routes them over the OSM network and fills `coordinates`. `"fromOsm": "w42488398"` copies an OSM area outline (here the Stadhuisplein).

## What's on the map

- **Events:** numbered pins on rooftops or at street level, shown once their time has passed, with a pulse on arrival.
  - **Off-screen events:** a pin outside the visible map area shows as a numbered chip on its edge, with an arrow towards it, so every event so far is always on screen. Clicking the chip flies to it.
  - **Confidence styles:** solid blue + ✓ = confirmed, outlined blue + “ = reported, dashed amber + ? = unverified, split amber + ≠ = disputed.
  - **Never colour alone:** every level also has its own fill pattern and glyph.
- **Movement:** dots move along street-following paths, with a fading glowing trail. Their speed follows the timeline.
- **Crowd:** a heat footprint plus hex columns. The solid core shows the low estimate; the translucent glass shell shows the high one, so the uncertainty is visible. A label gives the estimate and range.
- **Closures and reroutes:** a coral band with "tape" and 3D barriers on the closed road, and moving coral dashes for diverted buses.
- **Affected buildings:** tinted blue for confirmed involvement, coral for incidents or closures.
- **Toggles:** every layer can be switched on and off from the Layers panel at the top right (collapsed by default), which also holds the legend.

## Interactions

- **Timeline:** play/pause, 4× and 16× (4× is four story-minutes per second), live scrubbing, confidence-styled ticks, numbered chapter markers (the title shows on hover) and a large clock.
- **Selecting an event:** click a pin, an event building or a card. The camera glides there with its angle preserved, the detail card opens, and the timeline marks the moment.
- **The story panel:** scrolling it moves the clock and the camera through the chapters. "Scroll the card to see the story" pulses until the first scroll.
- **Deep links:** `#t=19:42&event=e5`.
- **Embed:** `?embed=1` keeps only the map, the timeline and a compact headline. The camera follows the chapters as the story plays, and page scrolling wins over the map (Ctrl/⌘ + scroll zooms). The story-maps case study embeds it in its hero.
- **Keyboard:**

  | Key | Action |
  |---|---|
  | Space | Play / pause |
  | ← → | Previous / next event |
  | Esc | Close |
  | / | Search |

  Pins, cards and controls are all focusable, with visible focus rings.
- **`prefers-reduced-motion`:** no intro, no idle drift, and static chevron markers instead of animated trails.
- **Mobile (< 768 px):** the story becomes a draggable bottom sheet with three snap points. The compact timeline sits above it, and the top bar keeps the logo and a short Portfolio link. Pinch replaces the zoom buttons, and the pixel ratio is capped at 2.

## Case study and the way back

- **Case study:** the button in the top bar opens the full case study, [`case-studies/story-maps/`](case-studies/story-maps/index.html). On phones, the Portfolio link leads back to it when the visitor came from there.
- **Back to portfolio:** the link at the top left returns to the case study when the visitor came from there, otherwise to the journey's Mapcreator stop.
- **Fictional notice:** the badges are gone; the standfirst calls the march fictional, and the case study says every event, figure and source is invented.

## Project structure

```
scripts/            build-time pipeline: fetch-osm, fetch-europe, bake-lighting, snap-paths
public/data/        Storyline: meta.json, *.geojson, lighting.png, story.json, story.schema.json
public/journey/     the journey: journey.json, europe.geojson, Macerata, Eindhoven and Den Haag districts
public/case-studies/ case-study.md and images for each case study
src/journey/        the journey page: camera flights, city growth, scroll story
src/casestudy/      the case-study pages: Markdown renderer and page chrome
src/story/          Storyline: story model (normalisation) and computeState(t)
src/map/            Storyline: MapLibre style, camera/intro/drift, time-driven story layers
src/ui/             Storyline: pins overlay, panel/scrollytelling, timeline, detail, search, share, layers, top bar
src/styles/         page styles (journey, case studies) and Storyline's tokens and interface styles
```

## Notes

- **Performance:**
  - The city is static. Lighting is baked, and MapLibre only repaints when something changes.
  - During playback, story layers update through `feature-state` and small GeoJSON sources, and pins are repositioned once per rendered frame.
  - Frame rate has not been profiled on a real GPU yet; checks so far ran in headless Chrome with software rendering.
- **Browsers:** tested in Chromium. Safari and Firefox have not been checked yet.
