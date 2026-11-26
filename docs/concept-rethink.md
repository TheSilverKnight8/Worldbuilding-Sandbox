# Worldbuilding app: rethink (working title)

## Core concept
- A high-quality *creative* worldbuilder, not a realistic one.
- No simulation.
- Scaled way back from the first design.
- For Caleb's own purposes.
- Starting over from scratch.

## Confirmed
- No simulation.
- Creative over realistic.
- Effort goes into quality, not breadth.
- Map and entries are equal ways into a world.
- "High quality" means how it looks, first.
- Only Caleb sees it: private, no sharing or presenting features.
- The map is drawn by the app (not an imported image).
- Map style is a toggle between two looks of the same world:
  - Fantasy atlas, drawn in the style of Nortantis
  - Colorful, classical painterly version that shows biomes
- Atlas style: essentially a clone of Nortantis, plus Caleb's other features.
- Entry pages follow the map's style toggle.
- Own version: own code and own art, using the same general techniques as Nortantis. No Nortantis code or art, so no AGPL requirement.
- Art (icons, textures) is drawn in code.
- Land: generate a random world, or start blank; edit either way.
- Atlas biomes show only through icons, like Nortantis (trees, dunes); biome colors are for the painterly version.
- Map features beyond land and water: rivers and lakes; roads; borders and regions; labels and decorations (compass rose, scale bar, ships and such).
- Borders and regions are drawn by hand only (growing them was a simulation job).
- Region overlays, each on its own: nations, cultures, factions.
- Labels and icons can each be plain (just drawn) or a node (a map item linked to an entry).
- A settlement's nation and culture fields are the truth; painted regions are drawings and may differ.
- Painterly version: biome colors plus the same icons as the atlas, in color.
- Elevation stays, and works both ways: shaping the elevation produces hills, mountains and other elevation-based geography, and placing those icons shapes the elevation. Random generation uses it too.
- Why elevation matters here: worldbuilding, notably designing military campaigns (elevation often decides battles).
- A terrain icon placed by hand stays exactly where it was put; the ground rises under it.
- Seeing elevation: a readout under the map, plus an elevation overlay to toggle on (like the region overlays).
- No importing of Nortantis maps. Every world starts in the app, generated or blank. (A `.nort` file stores seeds and edits, not shapes; reading it faithfully would have meant porting Nortantis's AGPL code.)
- Entry types are built in (a fixed set): the old spec's, minus everything that existed for the simulation (see Entries).
- Back from the old spec: images on entries, links between entries, search; timelines; diplomacy web; languages and names.
- Timelines use the real-world calendar. No playback (it existed for the sim).
- Platform: installable web app on GitHub Pages; runs on Mac and Windows through Chrome, in its own window. (A downloadable desktop app was considered and set aside.)
- Basics that still hold: local saving in the browser with autosave and export/import; up to 3 worlds; the app's frame and menus in the cream/navy/red family style (the map and entry pages follow the atlas/painterly toggle).

## Entries (old spec minus the simulation)
Structured fields listed; everything else is free write. Field rule now: a detail gets a field only if Caleb would filter or compare by it.
- **Settlement**: name; nation (or independent); dominant culture; demographic breakdown by culture; population; technology level; founded date. Terrain and biome shown from the map.
- **Nation**: name; dominant culture; government type; capital; founded date. Shown, not stored: its settlements, territory, total population, relations.
- **Culture**: name; its one language.
- **Language**: common and avoided letters or sounds, syllable patterns, stress, example names, free write. Name checking and generation. Assigned to cultures. "Names" means personal names; landmarks not covered.
- **Biome**: name; painterly color; atlas icon set (e.g. trees, dunes, none). The icon set is new: the atlas needs it.
- **Faction / people group**: name; type; size (membership, nations present in).
- **Geographical feature**: name; kind; size where it applies; location.
- **Landmark**: name; kind; location.
- **Road**: name; the settlements it connects.
- **Info node**: mostly free write; for things not tied to one object.
- **Group** (e.g. a mountain range): name; its members; its own entry. Members keep theirs.
- **Timeline event**: date; title; entries involved. Entries show their events.
- **Diplomacy strand**: between nations, cultures, factions; mutual; base type (Allied, Friendly, Neutral, Tense, Hostile, At war, Trade partner); several per pair.
- General: not every map item needs a written entry; a name changes only when Caleb edits it.

### Dropped (existed for the simulation)
- Resource type (raw materials, technology needed to harvest).
- Settlement: workers/soldiers split, happiness, loyalty, exports/imports, average and maximum wealth.
- Nation: policy focuses; economy and technology worked out from settlements.
- Culture: weighted leanings; new cultures made by the sim.
- Biome: resistance to change, major resources, hostility, economy and population worked out from them.
- Faction: policy focuses, influence, the happiness/loyalty override rules.
- Settlements and roads changing the terrain. (Terrain icons shaping elevation came back; see Confirmed.)
- Hand-set overrides of calculated values, locking, autopause, tuning, sim events (rebellions, wars, disasters), sim timeline, real-time playback, the sim changing the diplomacy web.

### Not wanted (from the old spec, still applies)
- Family trees, regional accents, culture branching, a "vassal or tributary" diplomacy type.

## Notes
- Random generation is a one-time terrain generator at the start, not the dropped simulation (Claude's reading; Caleb to correct if wrong).
- The scale-back is now mainly the removal of the simulation.
- Code-drawn icons look cleaner and more regular than Nortantis's hand-drawn ones. Build them as a swappable icon set, so hand-drawn art can replace them later.
- Stage 1 on `main` (worlds, local saving, export/import, 3 worlds, family style) matches the basics. The Stage 2 square grid does not match the polygon look.
- Looks come first on two surfaces (map and entry pages), while scope is scaled back. Keep that in view.
- The app drawing a Nortantis-style atlas itself (inked coasts, mountain/tree symbols, parchment) is likely the largest single piece of work.

## How Nortantis draws maps (from its source code)
- Java desktop app (Swing/AWT), about 218 source files. License: AGPL 3.0.
- World = a graph of irregular polygons (Voronoi cells, smoothed with Lloyd relaxation). Land/water, elevation, rivers and biome are per polygon.
- Random worlds come from a tectonic plate simulation; a blank canvas plus drawing tools is also offered.
- Coastlines and borders: "noisy edges" (Amit Patel's algorithm, MIT-licensed in its header) turn straight polygon edges into wiggly natural lines.
- Biomes: a standard list (tundra, taiga, temperate deciduous forest, grassland, desert, marsh...). On the map they show only through icons: tree icons by forest type, sand dunes in desert. No biome colors.
- Mountains and hills: icon sets (round, sharp, spires) grouped into ranges.
- Paper look: background textures grown from a sample image to any size, or fractal noise. Land and sea darken near coasts; concentric waves or ripples off the coast.
- Also draws rivers, roads, region borders and colors, text labels, compass roses, scale bars, ships, creatures.
- Art (trees, mountains, hills, dunes, cities, decorations, borders, textures) is a pack of image files. No separate license file found in the art folder; not yet checked further.
- Not drop-in: Java on the desktop, so its methods would be rewritten (its main drawing files are about 2,400 lines each).

## Open questions
- Which "other elevation-based geography" besides hills and mountains?
- Ground painted lower under a hand-placed mountain or hill: the icon goes, the icon stays, or the icon stops the ground from lowering?
- Elevation overlay form: contour lines, shading, or a choice of both?
- Elevation's other uses (proposed, not confirmed):
  - Generation: rivers run downhill, mountains follow ridges.
  - Entries show a place's elevation, read from the map (not stored), so it can be filtered and compared (e.g. settlements above 2,000 m).
  - Ocean depth: ocean biomes by depth could follow it, or the painterly ocean could darken with depth.
- Coordinate system (Caleb's idea, "might be helpful"); form open:
  - Readout: cursor position (and elevation, if A) under the map.
  - Units: grid cells; km, with a map scale set per world; or latitude/longitude.
  - On the map: an optional grid overlay (squares or hexes; Nortantis offers both) with labelled rows and columns, atlas style.

## Already built (on hold, untouched until this doc settles)
- `main`: Stage 1 (worlds, autosave, export/import), live
- `stage-2-map` branch: painted map, unmerged
