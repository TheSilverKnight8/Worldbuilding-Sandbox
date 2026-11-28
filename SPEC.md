# Worldbuilding Sandbox — Design Doc (v2)

Personal worldbuilding app, vibecoded with the same workflow as the other vibecoded apps (plan → prototype → escalate, consulting at each step). Rewritten in November 2026: the simulation is gone, and the app is now a creative, high-quality worldbuilder instead of a realistic one. The reasoning behind this version is in `docs/concept-rethink.md`; the first version is in this file's git history.

## Why

- World Anvil and other full-featured tools: paid, and not willing to pay.
- Azgaar: too hard to use.
- Nortantis: only a map maker. This app takes its look and adds my other features.
- Goal: something like the paid versions of World Anvil, in my own way with my own features.

## Direction

- Creative over realistic. No simulation of any kind.
- Quality over breadth. "High quality" means how it looks, first.
- Private: only I see it. No sharing or presenting features.
- The map and the entries are equal ways into a world.

## General rules

- Installable web app on GitHub Pages. Runs in Chrome on Mac and Windows, in its own window.
- Saved locally in the browser: autosave, plus manual export and import of a world as a file. No backup reminders.
- Up to 3 worlds; worlds can be deleted.
- The app's frame and menus use the cream, navy and red style of my other apps. The map and the entry pages follow the map style toggle.
- Entries have structured fields plus a free-write section. A detail gets a structured field only if I would filter or compare by it. Everything else is free write. Free write has simple formatting: headings, bold, italic, lists and quotes.
- Images can be attached to entries, as a gallery whose first image is the entry's cover. Entries link to each other inside the free write (typing [[), and each entry lists what links to it. Search across entries (names, free write and fields), with filters by type and by field.
- A world has two views, switched in the header: the map and the entries.
- Not every map item needs a written entry.
- A name changes only when I edit it.
- No bloat.

## Map

- Drawn by the app. No imported images, and no importing of Nortantis maps.
- A world starts as a randomly generated map or a blank one; either way it can be edited.
- Random generation is offered only when the map is set up. It has four settings (amount of land, continents or islands, how mountainous, climate) and a preview I can generate again until I keep one. It makes land, elevation, lakes, rivers, biomes and terrain icons (mountains, hills, volcanoes, plateaus, cliffs).
- Map size is set as width × height in kilometers; the area is shown in km². Distances and coordinates are in kilometers, with a readout under the map. No grid overlay.
- Built from irregular polygons, like Nortantis, not a square grid.

### Styles (a toggle between two looks of the same world)

- **Fantasy atlas**, in the style of Nortantis: parchment, inked coastlines, icons. Biomes show only through icons (trees, dunes).
- **Painterly**: colorful and classical. Biome colors, plus the same icons in color.
- The app's own code and art (art drawn in code), using the same general techniques as Nortantis. No Nortantis code or art, so no AGPL requirement.

### Land, water and elevation

- The ocean is just water: no ocean biomes, no depth. The focus is land detail.
- Land has elevation. It matters for worldbuilding, especially for designing military campaigns, because elevation often decides battles.
- Placing terrain icons shapes the elevation. Shaping the elevation does not place icons: only icons placed by hand are drawn, or by random generation, which places them the same way (so they can be moved, resized or deleted).
- Icons come before elevation. A terrain icon placed by hand stays exactly where I put it, and the elevation under it reads at least that icon's height, whatever is painted around it.
- Icons are placed as in Nortantis: in the middle of the polygon I click, one per polygon. Clicking a polygon that already has one rerolls its drawing; placing another kind there replaces it. A polygon that a neighbor's icon only reaches over can take its own, with the one in front drawn on top. Mountains, hills and volcanoes are sized by their polygon, whether placed by hand or generated.
- Terrain icons, starter set: hills, mountains, volcanoes, plateaus, cliffs. (Valleys and passes are not needed; canyons are dropped for now, since cliffs cover a drop.) Cliffs and waterfalls face any of the 8 compass directions, each drawn as seen from that side.
- Rivers, lakes and waterfalls follow the elevation. Random generation uses it too: rivers run downhill, mountains follow ridges.
- Rivers are either drawn by hand, exactly where I put them, or routed downhill by the app from a source I click. Lakes are water painted inside land. A waterfall appears where a river crosses a cliff, and waterfalls can also be placed by hand.
- Seeing elevation: the readout under the map, plus an elevation overlay to toggle on. The overlay uses both: land colored by height, with contour lines.

### Biomes

- Land only. Fields: name; painterly color (chosen by me); atlas icon set (e.g. trees, dunes, none).
- Starts with a list of basic land biomes.

### Other map features

- Rivers and lakes; roads; borders and regions; labels; decorations (compass rose, scale bar, ships and such).
- Labels and icons can each be plain (just drawn) or a node (a map item linked to an entry).
- Borders and regions are drawn by hand only. Region overlays, each on its own: nations, cultures, factions.
- A settlement's nation and culture fields are the truth; painted regions are drawings and may differ.

## Entry types and fields

Built in (a fixed set): the first version's types and fields, minus everything that existed for the simulation.

- **Settlement**: name; nation (or independent); dominant culture; demographic breakdown by culture; population; technology level (named eras in order: Stone age, Bronze age, Iron age, Medieval, Renaissance, Early modern, Industrial, Modern); founded date. Biome and elevation are shown from the map.
- **Nation**: name; dominant culture; government type; capital; founded date. Shown, not stored: its settlements, territory, total population, relations.
- **Culture**: name; exactly one language.
- **Language**: common letters or sounds, ones to avoid, typical syllable patterns, stress or emphasis, example names, plus free write.
- **Biome**: see Biomes.
- **Faction / people group**: name; type; size (membership, and the number of nations it is in).
- **Geographical feature**: name; kind; size where it applies; location.
- **Landmark**: name; kind; location.
- **Road**: name; the settlements it connects.
- **Info node**: general information not tied to one object. Mostly free write.
- **Group** (e.g. a mountain range): its own name and entry. Members keep their own entries.
- **Timeline event**: date; title; the entries involved; free write. Entries show the events that involve them.
- **Diplomacy strand**: see Diplomacy.

Kinds and types (a nation's government type, a faction's type, a feature's or landmark's kind) are picked from a starter list I can add to: anything typed in is offered afterwards in that world.

Place entries (settlements, landmarks, features) show the elevation at their spot, read from the map, and can be filtered and compared by it.

## Diplomacy

- A web of connections between nations, cultures, and factions or people groups.
- Strands are mutual. A pair can have more than one strand. Each has a base type (Allied, Friendly, Neutral, Tense, Hostile, At war, Trade partner) plus a free-write section.
- The web changes only when I change it.

## Timelines

- Real-world calendar. Dates to the day, including years before 1 (BC). The same dates are used for entries' founding dates.
- As many timelines of my own as I like.
- No playback.

## Languages

- A language stores general rules (see its fields). It checks names and can generate them, for settlements, nations, features, and personal names. Landmarks are not covered.
- Assigned to cultures and culture-adjacent groups.

## Explicitly not wanted

- Simulation of any kind: growth, sim events, playback, rewinding.
- Family trees
- Regional accents
- Culture branching
- A "vassal or tributary" diplomacy type
- Ocean biomes and ocean depth
- A grid overlay on the map
- Importing Nortantis maps

## Build decisions (the "how")

Most implementation is left to code's judgement. Decided so far:

- **Stack:** the same as my other apps (React, TypeScript, Vite, Tailwind, installable web app).
- **Existing work:** Stage 1 (worlds, autosave, export/import, 3 worlds, the app's style) stays as the foundation. The first version's map branch (`stage-2-map`, a square grid) is not merged; the polygon map replaces it.
- **Polygons:** a Voronoi polygon map (with a small, openly licensed library such as d3-delaunay), evened out with one pass of Lloyd relaxation, as Nortantis does, so polygons vary in size as much as Nortantis's. The world stores the polygons themselves, not just a random seed, so later changes to the generator never change an existing map.
- **Coastlines and borders:** noisy edges, written for this app from Amit Patel's published description (Red Blob Games).
- **Icons:** drawn in code as a swappable set, so hand-drawn art could replace them later.
- **Left to the stages:** the drawing technology and the number of polygons per map are decided in Stage 2 and written down in `docs/decisions.md`, for me to test.

### Build order

Macro to micro, with a test checkpoint at the end of each stage.

1. **Foundation** (done): worlds, autosave, export and import. Before Stage 2, the simulation leftovers are removed from the code and the notes.
2. **Polygon map and the atlas look:** map setup (size in km, blank start), polygons, drawing land and water (brush, fill, undo), zoom and pan, the km readout. Atlas drawing: parchment, inked noisy coastlines, coast shading, waves.
   *Checkpoint:* draw a continent and judge the atlas look.
3. **Biomes and the painterly look:** the starter land biomes with colors and atlas icon sets, painting biomes, tree and dune icons, the style toggle.
   *Checkpoint:* paint biomes and flip between the two looks.
4. **Elevation and terrain icons:** elevation tools, the starter terrain icons, elevation and icons shaping each other (icons win), the elevation readout and overlay.
   *Checkpoint:* shape a mountain range both ways and read the heights.
5. **Rivers, lakes and waterfalls**, following the elevation.
   *Checkpoint:* draw a river system.
6. **Random generation:** land, elevation, terrain icons, rivers and biomes, then edited by hand.
   *Checkpoint:* generate several worlds and edit one.
7. **Entries:** the built-in types and fields, entry pages that follow the style toggle, free write, images, links, search.
   *Checkpoint:* write up a handful of entries and find them again.
8. **Map items:** nodes (settlements, landmarks, features, info nodes, groups), labels and icons (plain or node), roads, place entries showing biome and elevation, decorations (compass rose, scale bar, ships).
   *Checkpoint:* place and label a region's settlements and roads.
9. **Peoples and regions:** nations, cultures and factions; hand-painted region overlays; the diplomacy web.
   *Checkpoint:* paint borders and set up relations.
10. **Timelines.**
    *Checkpoint:* build a timeline and see events on entries.
11. **Languages and names:** rules, name checking and generation. Independent of the rest, so it could go earlier.
    *Checkpoint:* define a language and generate names.

## Open items

- Where the language tools go in the build order.
