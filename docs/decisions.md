# Decisions made by Claude Code

The spec leaves most of the implementation to Claude Code ("Most implementation is left to code's judgement"). Each choice is written down here so Caleb can read it, test it and change it. Anything about *what* the app does that is not here or in `SPEC.md` was asked first.

`SPEC.md` was rewritten in November 2026 (version 2): the simulation is gone, and the app is a creative worldbuilder. The questions and answers behind it are in `docs/concept-rethink.md`. Choices below that only made sense for the first version have been removed.

## Build stages

The build order is in `SPEC.md` ("Build order"), agreed with Caleb: 11 stages, macro to micro, with a test checkpoint after each.

1. Foundation **(done)**, then the cleanup of simulation leftovers **(done)**.
2. Polygon map and the atlas look **(done)**.
3. Biomes and the painterly look **(this stage)**.

The first version's Stage 2 (a painted square grid, branch `stage-2-map`) is not merged; the polygon map replaces it. The branch is kept for reference.

## Caleb's answers used here

| Question | Answer |
| --- | --- |
| App name | Worldbuilding Sandbox. |
| Devices | Chrome on a computer only (Mac and Windows, from the rethink). |
| Data structure | The shape under "Data structure" below. |
| Importing a world when all 3 slots are full | Refuse, and ask to delete a world first. |
| Everything about the version 2 direction | See `docs/concept-rethink.md`. |
| Atlas sea (Stage 2 checkpoint) | A lighter or darker brown, not blue. (Darker brown chosen.) |
| Painterly sea (Stage 3) | Blue. |
| Starter biomes (Stage 3) | Fewer, simpler: a short list of broad biomes. |
| Edges between biomes on the painterly map (Stage 3) | Soft, blended. |

## Platform

| Item | Choice | Why |
| --- | --- | --- |
| Stack | React, TypeScript, Vite, Tailwind CSS, vite-plugin-pwa, react-router. Same versions as Synth Studio and Stickman Arena. | Same family as the other projects. |
| Hosting | GitHub Pages, published by `.github/workflows/deploy.yml` on every push to `main`. | Spec. |
| Public repository | Free GitHub Pages needs a public repository. Only the code is public; worlds never leave the browser. | Fits "private". |
| Size | GitHub Pages allows a published site of up to 1 GB, with a soft limit of 100 GB of bandwidth a month (GitHub Docs, checked November 2026). The Stage 1 build is about 0.7 MB. | Art is drawn in code (spec), so it adds no image files. |

## Storage (Stage 1)

| Item | Choice | Why |
| --- | --- | --- |
| Where worlds live | IndexedDB, in this browser on this computer. | The spec says local browser storage. localStorage only holds text and is much smaller; images and map data need room. Chrome lets one site use up to about 60% of the disk (MDN). |
| Layout | Three stores: `worlds` (the list Home shows), `docs` (each whole world, without its images), `blobs` (images and other binary data, keyed by world ID and blob ID). | Home does not have to load whole worlds. A world's blobs can be found or removed together, and two worlds can never clash. |
| Autosave | Half a second after the last change, and at once when the app is hidden or closed. If the window closes during a save, Chrome asks first. The header shows **Saving** / **Saved**, or **Could not save. Try again** (click to retry). | Same as Synth Studio. |
| Keeping the storage | The app asks Chrome for persistent storage (`navigator.storage.persist()`) whenever there is at least one world. Chrome decides on its own whether to agree. Home shows, in one line, whether it has agreed and how much space the app uses. | Without it, Chrome may clear a site's storage when the disk runs low. The spec says no backup reminders, so the line only states the fact. |
| The same world in two tabs | Only one tab or window can have a world open (Web Locks API). A second one says the world is open in another window. Different worlds can be open in different tabs. | Two copies of one world open at once would each save over the other's changes. |

## Worlds (Stage 1)

| Item | Choice |
| --- | --- |
| Slots | 3, oldest first, so each world keeps its place. An empty slot is a **New world** button. |
| Create | Asks for a name, then opens the new world. |
| Delete | Asks to confirm ("This cannot be undone"), then removes the world and all its images from the browser. |
| Rename | Not built. The spec names create and delete only. |
| Inside a world | A full-screen work area (like Synth Studio's editors) with a slim stripe and the C mark at the bottom. Until Stage 2 it only shows the world's name and creation date. |

## Export and import (Stage 1)

| Item | Choice |
| --- | --- |
| File | One file per world, named after it: `<name>.world.json`. JSON text with `format`, `version`, the export date, the world, and its images (as Base64 text, which makes them about a third bigger in the file than in storage). |
| Where it goes | Chrome's downloads (the Downloads folder, or wherever Chrome asks, if it is set to ask). |
| Reading a file | Checks the format and version. A file from a newer version of the app is refused with the reason. A damaged record is skipped rather than refusing the whole file. |
| All 3 slots full | Refused, with a message to delete a world first (Caleb's answer). Creating a fourth world is refused the same way. |
| The same world already in the app | An imported world keeps its ID. If that ID is already in the app (for example, the same file imported twice), the import becomes a separate copy with a new ID and the same name. |

## The polygon map (Stage 2)

The spec left two things to this stage: the drawing technology and the number of polygons. Both are below, for Caleb to test.

### Setting it up

| Item | Choice | Why |
| --- | --- | --- |
| Size | Width and height in km, typed in; the area shows in km². Each side 10 to 40,000 km. The long side may be at most 4 times the short side. | Spec: size in km. Very long, thin maps would squash the polygons. |
| New map | All water; Caleb draws the land. | Spec: start blank. (Random generation is Stage 6.) |
| Polygons | **16,000 per map.** Random points, their Voronoi cells (d3-delaunay 6.0.6, ISC license), evened out with 2 rounds of Lloyd relaxation. Making them takes about half a second. | Nortantis allows 2,000 to 32,000; 16,000 is in the middle. Caleb to judge whether drawing feels fine enough. |
| Stored polygons | The polygons themselves are stored with the world (about 1.15 MB), not a random seed. | Spec: later changes to the generator never change an existing map. |
| Map units | Positions are in map units, with the long side 1,000 units. Kilometers come from the map's size. | Drawing and the polygons do not depend on the km size. |
| Land | One byte per cell (land or water), saved with the world in the same step as the rest of it. | |

### Coastlines

| Item | Choice |
| --- | --- |
| Noisy edges | Written for this app from Amit Patel's published idea (Red Blob Games): each straight edge between a land cell and a water cell becomes a wiggly line that stays inside the shape made by the edge's ends and the two cell centers (reaching halfway toward each center), so neighboring wiggles never cross. About 8 points per edge. The wiggle is seeded by the map's own seed, so it is the same every time. |
| Coast tracing | Every land/water edge, chained into loops. Outside the map counts as water, so land touching the map's edge still fills; but there is no ink or waves along the map's border. Lakes are holes in the land. Takes about 6 ms, so it is redone on every brush dab. |

### Drawing the atlas

| Item | Choice | Why |
| --- | --- | --- |
| Technology | The browser's 2D canvas. | Inked lines, textures, icons and lettering (later stages) are what it is built for; it draws like a printed map. |
| Sizes | In map units, so the look scales like a printed map when zooming. Thin lines never get thinner than about one screen pixel. | |
| Paper | A parchment texture made in code (soft blotches from layered smooth noise, plus grain), repeated seamlessly. | Spec: art drawn in code. |
| Sea | A darker brown than the land, multiplied over the paper, darker still along the coast (a blurred band about 9 units wide). | Caleb: brown, not blue (after trying a blue-grey at the Stage 2 checkpoint). Easy to make lighter instead. |
| Waves | 3 rings off the coast, at 2.4, 5.0 and 7.6 units, thin ink at half strength. | Nortantis offers up to 5 rings. |
| Land | The paper itself, slightly darker just inside the coast. | |
| Ink | The coastline in dark brown ink, 0.75 units wide; a frame around the map. | |
| Speed | A full drawing took about 125 ms in the test browser, which has no graphics card. While a brush stroke is under way, a quick drawing (paper, sea, land, ink; no shading or waves) takes about 15 ms; the full drawing follows when the stroke ends. While zooming or panning, the last drawing is moved and scaled, and the full drawing follows 0.1 s after it stops. | Smooth on any computer; a computer with a graphics card draws faster. |

### Tools

| Item | Choice |
| --- | --- |
| Land or water | A switch; **X** swaps. **Alt+click** picks land or water from the map. |
| Brush | Paints every cell whose center is under the brush (and the cell under the cursor, even for the smallest brush). Size shown as the brush's width in km; the slider runs from about half a cell to a fifth of the map's short side (or **[** and **]**). |
| Fill | Fills the connected land or water you click (cells sharing an edge). |
| Undo | **Ctrl+Z**, redo **Ctrl+Shift+Z** or **Ctrl+Y**; the last 100 strokes or fills while the world is open. |
| Moving around | Wheel zooms around the cursor (Ctrl+wheel and trackpad pinch too, without zooming the page). Drag with the middle button, the hand tool (**H**) or **Space** held. A button fits the map in the window. |
| Readout | Under the map: the position in km east and km south of the map's top-left corner, land or water, the map's size, the zoom. |

### Format

- Format version **3** adds the map. Stage 1 worlds (version 1) open to map setup. Worlds from the abandoned square-grid branch (version 2) drop that grid map and its ocean biomes, keep any land biomes, and open to map setup.
- If a map's stored land cannot be read, it is reset to water with a notice; if its polygons cannot be read, the world opens to map setup with a notice. Neither crashes.

## Biomes and the painterly look (Stage 3)

### Biomes

| Item | Choice |
| --- | --- |
| Fields | Name; **color** on the painterly map (Caleb's choice per biome); **icons** on the map. Land only. |
| Starter list | Forest (leafy trees), Pine forest (pine trees), Jungle (jungle trees), Grassland (grass tufts), Desert (dunes), Swamp (reeds), Tundra (no icons), Ice (no icons). Added once per map, and only if the world has no biomes yet, so deleting them all does not bring them back. All can be renamed, recolored, given other icons or deleted. |
| Icon sets | Leafy trees, pine trees, jungle trees, cacti, shrubs, grass tufts, dunes, reeds, or no icons. |
| Limit | 255 biomes per world (the grid stores one byte per cell). |
| Deleting | Asks first; land painted with it goes back to no biome. It also clears the undo history, which could otherwise paint the deleted biome back. |
| Old maps | A Stage 2 map (format 3) opens with the starter biomes and an empty biome grid. Format 4 adds the biome grid and the biome slots (which biome each grid number means). |

### Painting

| Item | Choice |
| --- | --- |
| Modes | **Land & water** or **Biomes**. Picking a biome in the panel switches to Biomes. **X** switches back to land and water and swaps them. |
| Biome brush | Paints only land cells; water cells under the brush are left alone. **No biome (erase)** clears biomes. |
| Biome fill | Fills the connected land cells (sharing an edge) that have the same biome as the one clicked. On water it does nothing. |
| Water over biomes | A cell turned to water loses its biome (biomes are for land). Undo brings back both. |
| Alt+click | In Biomes mode, picks the biome under the cursor. |

### Icons (drawn in code)

| Item | Choice | Why |
| --- | --- | --- |
| Drawing | Each icon is drawn in code once at the size it shows on screen, then stamped wherever it goes. Ink on paper for the atlas; colored for the painterly map. | Spec: art drawn in code, as a swappable set. Thousands of trees stay fast. |
| Placement | A few per land cell, jittered around the cell's center, the same every time (seeded by the map and the cell): 2 per cell for trees, fewer for cacti and dunes. Cells on the coast get one smaller icon at their center (dunes none), so icons stay off the water. Drawn top to bottom, so nearer icons overlap farther ones. | Like Nortantis's forests. |
| Size | About one cell tall for trees, half for grass, one and a half cells wide for dunes. | |
| Too small to read | Icons smaller than a few screen pixels are not drawn: trees below 5 px, dunes below 8, grass and reeds below 10. So grassland and swamps show their icons only once zoomed in. | Tiny grass turned into dark specks across the whole land. |

### The painterly look

| Item | Choice |
| --- | --- |
| Sea | Blue (Caleb), lighter along the coast (a soft band about 14 units wide). |
| Land | Each cell in its biome's color, blended softly into its neighbors (a blur of about 2.4 map units); land with no biome is a pale ochre. Water cells next to land take that land's color in the hidden color picture, so the blending never pulls a pale fringe into the coast. |
| Paper | The parchment texture shows through the paint (multiplied at 45%), so it reads as paint on paper. |
| Coastline | A thin dark blue-grey line. No wave rings (those are the atlas's). |
| Icons | The same icons as the atlas, in color. |
| Speed | The biome colors are kept in a picture that is repainted only where land or biomes change, so painting stays quick. In the test browser (no graphics card) a full painterly drawing took about 50 ms and an atlas drawing about 120 ms. |

### The look toggle

| Item | Choice |
| --- | --- |
| Where | **Atlas / Painterly** in the toolbar. |
| Remembered | Per world, on this computer (not part of the world, so not in exports). Entry pages will follow it (Stage 7). |

## Data structure (agreed with Caleb)

In `src/lib/world/types.ts`. Settled in Stage 1 because it is costly to change once material is entered.

- Everything in a world is a **record** with an ID and a kind: settlement, feature, landmark, road, info node, group, biome, nation, culture, faction, diplomacy strand, timeline, event, language.
- Records point at each other **only by ID**. Renaming never breaks a link, and a name only changes when Caleb edits it.
- **Structured fields** live on the record. Each kind's fields are added in the stage that builds it, following the spec's rule: a field only if Caleb would filter or compare by it.
- **Free write, images and links are optional.** A map node nobody wrote up is only its fields and location.
- **Blobs** (attached images, map data) are stored apart from the records, and records refer to them by blob ID.
- Every stored world and exported file has a **format version**. When the shape changes, `upgrade()` in `src/lib/world/format.ts` brings older worlds and files forward.

## Cleanup of simulation leftovers (before Stage 2)

| Removed | Why | Effect on saved worlds |
| --- | --- | --- |
| `Settable` (a value worked out by the app or simulation, with a hand-set override) | Existed for simulation values. | None: nothing ever saved one. |
| `locked` on records | Locking existed to keep the simulation away from an entry. | None: nothing ever set it. |
| The Resource record kind | The Resource type existed only for the simulation's economy. | None: no Resource records were ever made. |
| Stage numbers in code comments | They pointed at the first version's build order. | None. |
| "An optional simulation" in the app's description (install prompt, page description) | No longer true. | None. |

Because no saved world or file changes shape, the format version stays at 1.

**Next format version is 3, not 2.** Version 2 was used by the abandoned `stage-2-map` branch (its square-grid map). If Caleb ever opened that branch locally, a world saved there says version 2 and holds that grid. Stage 2's polygon map will use version 3, and `upgrade()` will treat version 2 as "the old grid map", dropping it, so such a world is never misread.

## Look

- The portal's, Synth Studio's and Stickman Arena's style for the app's frame and menus: cream, navy and red; Norwester headings; Archivo body text; staggered stripes; flat cards. Light mode only.
- Logo: the full Croswell Industries logo on Home; the C mark in the gap left of the bottom stripes inside a world.
- App icon: a cream landmass with a bay, a small islet and a red map pin, on navy.
