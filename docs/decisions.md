# Decisions made by Claude Code

The spec leaves most of the implementation to Claude Code ("Most implementation is left to code's judgement"). Each choice is written down here so Caleb can read it, test it and change it. Anything about *what* the app does that is not here or in `SPEC.md` was asked first.

## Build stages (from the spec, agreed with Caleb)

Macro to micro, with a test checkpoint at the end of each stage.

1. Foundation: up to 3 worlds, create and delete, autosave, export and import. **(done)**
2. Map: image backdrop, painting the data layer (land, ocean, biomes), overlay toggles. Plus hand-set elevation (Caleb). **(this stage)**
3. Libraries: biomes, resources, cultures, languages, with their fields.
4. Map items: settlements, features, landmarks, roads, info nodes, groups, entries with images, search.
5. Nations, factions, and the diplomacy web, with territory overlays.
6. Time and timelines.
7. Simulation, in sub-steps (growth, culture, rebellions and war, disasters, then tuning, locking, and autopause), each tested on its own.
8. Language tools: name checking and generation.

Still open (spec, "Open items"): where the simulation and the language tools go in this order. To be decided with Caleb when the build gets near them.

## Caleb's answers used here

| Question | Answer |
| --- | --- |
| App name | Worldbuilding Sandbox. |
| Devices | Chrome on a computer only. |
| Data structure (spec, "Open items") | The shape under "Data structure" below. |
| Importing a world when all 3 slots are full | Refuse, and ask to delete a world first. |
| The backdrop image (Stage 2) | Not permanent. It is to be removed eventually and replaced by land and ocean drawn by the app. |
| Biome colors (Stage 2) | Each biome's color is chosen by Caleb. |
| Starting biomes (Stage 2) | Start with a list of basic biomes. Ocean biomes are organized mostly by depth. |
| Seeding and spreading biomes | Comes with the simulation (Stage 7), not Stage 2. |
| Height (Stage 2) | Height and topography come with geographical features (Stage 4), but elevation can also be set by hand. |
| The rest of the Stage 2 plan | Accepted: a 1024-cell grid, brush, fill, undo, wheel zoom and drag, a new map starts as ocean, a layers panel (political, cultural and faction overlays join it in Stage 5). |

## Platform

| Item | Choice | Why |
| --- | --- | --- |
| Stack | React, TypeScript, Vite, Tailwind CSS, vite-plugin-pwa, react-router. Same versions as Synth Studio and Stickman Arena. | Same family as the other projects. |
| Hosting | GitHub Pages, published by `.github/workflows/deploy.yml` on every push to `main`. | Spec. |
| Public repository | Free GitHub Pages needs a public repository. Only the code is public; worlds never leave the browser. | Fits "private, or at least locally saved". |
| Size | GitHub Pages allows a published site of up to 1 GB, with a soft limit of 100 GB of bandwidth a month (GitHub Docs, checked November 2026). The Stage 1 build is about 0.7 MB. | The simulation is code, not media, so size will not decide whether it fits. |

## Storage (Stage 1)

| Item | Choice | Why |
| --- | --- | --- |
| Where worlds live | IndexedDB, in this browser on this computer. | The spec says local browser storage. localStorage only holds text and is much smaller; images and the map backdrop need room. Chrome lets one site use up to about 60% of the disk (MDN). |
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
| Inside a world | A full-screen work area (like Synth Studio's editors) with a slim stripe and the C mark at the bottom. Since Stage 2 it holds the map. |

## Export and import (Stage 1)

| Item | Choice |
| --- | --- |
| File | One file per world, named after it: `<name>.world.json`. JSON text with `format`, `version`, the export date, the world, and its images (as Base64 text, which makes them about a third bigger in the file than in storage). |
| Where it goes | Chrome's downloads (the Downloads folder, or wherever Chrome asks, if it is set to ask). |
| Reading a file | Checks the format and version. A file from a newer version of the app is refused with the reason. A damaged record is skipped rather than refusing the whole file. |
| All 3 slots full | Refused, with a message to delete a world first (Caleb's answer). Creating a fourth world is refused the same way. |
| The same world already in the app | An imported world keeps its ID. If that ID is already in the app (for example, the same file imported twice), the import becomes a separate copy with a new ID and the same name. |

## The map (Stage 2)

### Setting it up

| Item | Choice |
| --- | --- |
| Starting a map | Inside a world with no map: **From an image** (the grid takes the image's shape) or **Blank** (Wide 2:1, Landscape 3:2, Square, Portrait 2:3). |
| Grid | 1024 cells on the long side (Caleb accepted). A 2048 × 1365 image gives a 1024 × 683 grid. |
| New map | All ocean, 1,000 m deep. The starter biomes are added if the world has no biomes yet. |

### Elevation is the coastline

| Item | Choice | Why |
| --- | --- | --- |
| One elevation grid | Each cell stores its elevation in whole meters (−11,000 to 9,000). A cell is land when it is above 0 m and ocean otherwise, so the coastline is where elevation crosses sea level. | Caleb wants elevation set by hand, and Stage 4's geographical features will change height. With one grid, land, ocean and height can never disagree, and the simulation reads one thing. |
| Land brush | Lifts ocean cells to 10 m. Land that is already higher stays as it is. | Painting land over hills does not flatten them. |
| Ocean brush | Sinks land cells to 10 m deep. Ocean that is already deeper stays as it is. | |
| What follows from it | Lowering land below 0 m turns it into ocean, and raising ocean above 0 m makes an island. Land below sea level (like the Dead Sea shore) cannot exist. In Stage 4, a feature that raises the ground in the ocean could make an island. | Worth knowing; ask if any of it should work differently. |
| Units | Meters. | |

### Biomes

| Item | Choice |
| --- | --- |
| Fields for now | Name, **land or ocean**, and map color (Caleb: selectable). "Land or ocean" is a structured field because the painting tools read it. Resistance, major resources and hostility come in Stage 3. |
| Painting rule | A land biome only goes on land cells and an ocean biome only on ocean cells; elsewhere the brush leaves cells alone. A cell that crosses sea level (by the land, ocean or elevation brush) loses its biome. Changing a biome between land and ocean clears the cells it was painted on. |
| Starter list | Land: Tropical rainforest, Tropical dry forest, Savanna, Desert, Mediterranean scrub, Temperate grassland, Temperate forest, Boreal forest, Tundra, Alpine, Wetland, Mangrove, Ice sheet. Ocean, mostly by depth: Continental shelf (about 0–200 m), Continental slope (200–4,000 m), Abyssal plain (4,000–6,000 m), Hadal trench (6,000 m and more), plus Coral reef and Sea ice. The depth ranges are written in each ocean biome's free write. |
| Where the list comes from | The land list is a simplified take on the WWF's major biome categories (Olson et al. 2001), not an official list. The ocean depth bands follow common oceanography (shelf to about 200 m, abyssal plains about 4,000–6,000 m, the hadal zone below about 6,000 m); sources disagree a little on the exact boundaries. |
| Limit | 255 biomes per world (the grid stores one byte per cell). |
| Deleting a biome | Asks first. Its cells go back to no biome. |
| Ocean biomes and depth | Ocean biomes are painted like land biomes; they do not follow the depth by themselves. *(Asked Caleb at the Stage 2 checkpoint.)* |

### Drawing the map

| Item | Choice |
| --- | --- |
| How | WebGL 2 in the browser, straight from the grids, redrawn only when something changes. |
| Coastline | Smoothed into curves (a cubic B-spline through the cells' land/ocean), with a thin navy line. A lone land cell still shows as a small island. A single ocean cell surrounded by land is drawn as land (the readout still says ocean). When zoomed in far (about 6× and more), long coasts show softened one-cell steps; that is the grid's own resolution. |
| Biome colors | Each cell's biome color, with crisp edges between biomes. Near the coast, land takes the nearest land cell's biome and ocean the nearest ocean cell's, so colors never cross the coastline. |
| No biome | Land without a biome is parchment. Ocean without a biome is shaded by depth, light near the coast and navy in the deep. |
| Relief shading | Slopes lit from the northwest, from the elevation. |

### Tools

| Item | Choice |
| --- | --- |
| Modes | Land & ocean, Biomes, Elevation. |
| Brush | Round, radius 1 to 64 cells (slider, or `[` and `]`). The brush outline shows its true size on the map. |
| Fill | Land & ocean: fills the connected land or ocean (four neighbors) that you click. Biomes: fills the connected cells on the same side of the coast with the same biome. Not in Elevation mode. |
| Elevation | **Set** (an exact height, typed in meters), **Raise** and **Lower** (by a typed amount at the brush center per dab, fading to the edge), **Smooth** (averages with neighbors). |
| Undo | Ctrl+Z, redo Ctrl+Shift+Z or Ctrl+Y. The last 100 strokes or fills, while the world is open. Deleting a biome or switching it between land and ocean clears the history (it cannot be undone). |
| Picking from the map | Alt+click: in Land & ocean mode takes land or ocean, in Biomes mode takes the biome, in Elevation mode switches to Set with that cell's height. |
| Moving around | Wheel zooms around the cursor (Ctrl+wheel and trackpad pinch too, without zooming the page). Drag with the middle button, the hand tool (H) or Space held down. A button fits the map in the window. |
| Readout | Under the map: the cell, land or ocean, elevation, biome. |

### Layers and the image

| Item | Choice |
| --- | --- |
| Layers panel | **Image** (on/off, opacity), **Land and ocean**, meaning the app's own map (on/off, opacity), and inside it **Biomes** and **Relief shading**. Political, cultural and faction overlays join this panel in Stage 5. The panel's settings are not saved; they reset when the world is opened. |
| With an image | The app's map starts half see-through so the image shows for tracing. Removing the image makes the map fully opaque; adding one makes it half see-through again. |
| The image | Stored in the world exactly as chosen (no recompression), so it is in exports too. **Replace** keeps everything painted; an image of a different shape is stretched to fit, with a notice. **Remove** asks first, then deletes it from the world for good; the painted map stays (Caleb: the image is not permanent). A blank map can get an image later. |
| Saving | The grids save with the world, in the same step, half a second after a stroke ends. A map without an image adds about 2.8 MB to an export. |

## Data structure (agreed with Caleb)

In `src/lib/world/types.ts`. Settled in Stage 1 because it is costly to change once material is entered.

- Everything in a world is a **record** with an ID and a kind: settlement, feature, landmark, road, info node, group, biome, resource, culture, language, nation, faction, diplomacy strand, timeline, event.
- Records point at each other **only by ID**. Renaming never breaks a link, and a name only changes when Caleb edits it.
- **Structured fields** live on the record. Each kind's fields are added in the stage that builds it, following the spec's rule (a field only if the sim reads or changes it, or it gets filtered or compared).
- **Free write, images and links are optional.** A map node nobody wrote up is only its fields and location.
- **Anything the app or the simulation works out can also be set by hand** (`Settable`): `auto` is the worked-out value, `manual` is set by hand, and `manual` wins when it is present.
- **Locking:** each record has a `locked` flag the simulation must respect.
- **Blobs** (attached images, the map backdrop, map layers) are stored apart from the records, and records refer to them by blob ID.
- **The map** (Stage 2) is `WorldDoc.map`: the grid size, the blob IDs of the elevation and biome grids, the biome slots (which biome each grid number means), and the image under it. Format version 2.
- Every stored world and exported file has a **format version**. When the shape changes, `upgrade()` in `src/lib/world/format.ts` brings older worlds and files forward.

## Look

- The portal's, Synth Studio's and Stickman Arena's style: cream, navy and red; Norwester headings; Archivo body text; staggered stripes; flat cards. Light mode only.
- Logo: the full Croswell Industries logo on Home; the C mark in the gap left of the bottom stripes inside a world.
- App icon: a cream landmass with a bay, a small islet and a red map pin, on navy.
