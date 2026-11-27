# Decisions made by Claude Code

The spec leaves most of the implementation to Claude Code ("Most implementation is left to code's judgement"). Each choice is written down here so Caleb can read it, test it and change it. Anything about *what* the app does that is not here or in `SPEC.md` was asked first.

`SPEC.md` was rewritten in November 2026 (version 2): the simulation is gone, and the app is a creative worldbuilder. The questions and answers behind it are in `docs/concept-rethink.md`. Choices below that only made sense for the first version have been removed.

## Build stages

The build order is in `SPEC.md` ("Build order"), agreed with Caleb: 11 stages, macro to micro, with a test checkpoint after each.

1. Foundation **(done)**, then the cleanup of simulation leftovers **(done)**.
2. Polygon map and the atlas look **(done)**.
3. Biomes and the painterly look **(done)**.
4. Elevation and terrain icons **(done)**; the map icons were redrawn during it.
5. Rivers, lakes and waterfalls **(done)**; cliffs and waterfalls got a drawing for each direction during it.
6. Random generation **(this stage)**.

The first version's Stage 2 (a painted square grid, branch `stage-2-map`) is not merged; the polygon map replaces it. The branch is kept for reference.

## Caleb's answers used here

| Question | Answer |
| --- | --- |
| App name | Worldbuilding Sandbox. |
| Devices | Chrome on a computer only (Mac and Windows, from the rethink). |
| Data structure | The shape under "Data structure" below. |
| Importing a world when all 3 slots are full | Refuse, and ask to delete a world first. |
| Everything about the version 2 direction | See `docs/concept-rethink.md`. |
| Atlas sea (Stage 2 checkpoint) | A lighter or darker brown, not blue. (Darker brown chosen; replaced in Stage 4, below.) |
| Atlas sea, land and coast (Stage 4) | Match Caleb's own Nortantis map: pale sea, darker olive-tan land, a dark band just inside the coast, no wave rings. |
| Painterly sea (Stage 3) | Blue. |
| Starter biomes (Stage 3) | Fewer, simpler: a short list of broad biomes. |
| Edges between biomes on the painterly map (Stage 3) | Soft, blended. |
| Placing icons (Stage 4) | Besides brushes, a way to place single icons, trees and other non-mountain icons included. |
| Hover (Stage 4) | The polygon under the mouse is outlined. |
| Elevation and the coast (Stage 4) | Elevation is for land only; the coast stays where it was painted. Lowering stops at sea level, and raising the sea does nothing. |
| Cliffs, canyons and valleys (Stage 4) | Single icons you can rotate. (Valleys, passes and canyons were later dropped, below; in Stage 5 turning gave way to a drawing per direction.) |
| Mountain size (Stage 4) | Close to Nortantis's, which are bigger than the first ones drawn here. |
| Icon art (Stage 4) | The first code-drawn icons did not look right. Caleb's own Nortantis map is the reference for the whole look. Mountains and hills in the style of the free bonus art pack for Nortantis; every other icon in the style of the FA01-Temperate pack. Icons drawn in code after comparing with AI images (Canva), with heavier shading, slightly thicker lines and rounder peaks; then a little lighter. Caleb will ask for custom icons once the first pass is done. |
| Terrain icons kept (Stage 4) | Mountains, hills, volcanoes, plateaus and cliffs. Valleys and passes are not needed; canyons dropped for now (cliffs cover a drop). |
| Cliffs (Stage 4) | One side only: a tall drop. North-facing cliffs show no face. No inked sides, so cliffs placed end to end join. Caleb chooses each cliff's shape (even, fading out to one side, or broken). |
| Scaling (Stage 4) | Each icon can be sized on its own, the app's own icons included: selecting one takes it over as an icon placed by hand. |
| Sizes (Stage 4) | Mountains 5.5 cell spacings wide, each sized by its polygon as in Nortantis, varying as much as there. Plants half their first size next to the terrain. |
| Icons from elevation (after trying Stage 4) | Taken out: placing a mountain raised the ground and the app then drew more mountains around it. The elevation and heightmap stay (painting, readout, overlay, and icons placed by hand shaping the ground); only icons placed by hand are drawn. `SPEC.md` updated to match, at Caleb's request. |
| Cliff size (after trying Stage 4) | A little smaller by default. |
| Rivers drawn by hand (Stage 5, the spec's open item) | Both: draw one exactly where wanted, or click a source and let the app route it downhill. `SPEC.md` updated to match (with the lakes, waterfalls and 8 directions below) and the open item closed, at Caleb's request. |
| Waterfalls (Stage 5) | Both: one appears by itself where a river crosses a cliff, and they can be placed by hand. |
| Lakes (Stage 5) | Stay painted water inside land. |
| Where generation is offered (Stage 6) | At setup only: start from open water or a generated map; generate again as often as wanted before keeping one, then edit by hand. |
| Generation settings (Stage 6) | All four: amount of land, continents or islands, how mountainous, climate. |
| Generated terrain icons (Stage 6) | Like icons placed by hand: stored, movable, resizable, deletable, shaping the elevation; nothing redrawn from the elevation. |
| What generation places (Stage 6) | Besides land, elevation, rivers and biomes: mountains and hills, volcanoes, plateaus and cliffs, and lakes. |
| Directions (Stage 5) | Cliffs in all 8 compass directions, each a drawing of its own (turning the south-facing drawing tipped its face sideways), chosen with 8 buttons; cliffs already placed at other angles are drawn as the nearest. Waterfalls in all 8 too, and one appears at every cliff a river crosses, facing away included (lip and mist only). |

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
| Coast tracing | Every land/water edge, chained into loops. Outside the map counts as water, so land touching the map's edge still fills; but there is no ink along the map's border. Lakes are holes in the land. Takes about 6 ms, so it is redone on every brush dab. |

### Drawing the atlas

| Item | Choice | Why |
| --- | --- | --- |
| Technology | The browser's 2D canvas. | Inked lines, textures, icons and lettering (later stages) are what it is built for; it draws like a printed map. |
| Sizes | In map units, so the look scales like a printed map when zooming. Thin lines never get thinner than about one screen pixel. | |
| Paper | A parchment texture made in code (soft blotches from layered smooth noise, plus grain), repeated seamlessly. | Spec: art drawn in code. |
| Sea | Pale: about #d8c5a6, multiplied over the paper, with a thin soft shadow just off the coast. No wave rings. | Matched to Caleb's own Nortantis map (Stage 4). Before that: a darker brown than the land with 3 wave rings (Caleb: brown, not blue, at the Stage 2 checkpoint). |
| Land | A darker olive tan (about #b7a97e), multiplied over the paper, darker still in a soft band about 5 units wide just inside the coast. Icons are filled with a tone a little lighter than the land. | Matched to Caleb's map (Stage 4): there the sea is lighter than the land. Measured: land #b6a87d against #b7a97e there, sea #d7c4a5 against #dac7a7. |
| Ink | The coastline in dark brown ink, 0.75 units wide; a frame around the map. | |
| Speed | A full drawing took about 125 ms in the test browser, which has no graphics card. While a brush stroke is under way, a quick drawing (paper, sea, land, ink; no shading) takes about 15 ms; the full drawing follows when the stroke ends. While zooming or panning, the last drawing is moved and scaled, and the full drawing follows 0.1 s after it stops. | Smooth on any computer; a computer with a graphics card draws faster. |

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
| Drawing | Drawn in code; redrawn in Stage 4 in the style of the FA01-Temperate pack (see "The icons" under Stage 4). Ink for the atlas; colored for the painterly map. | Spec: art drawn in code, as a swappable set. |
| Placement | A few per land cell, jittered around the cell's center, the same every time (seeded by the map and the cell): 4 per cell for leafy and pine trees, 3 for palms, 2 for shrubs and reeds, fewer for grass, cacti and dunes (Stage 4, when the plants got smaller). Cells on the coast get one smaller icon at their center (dunes none), so icons stay off the water. Drawn top to bottom, so nearer icons overlap farther ones. | Like Nortantis's forests. |
| Size | Widths in cell spacings (Stage 4, half their first size next to the terrain): leafy tree 0.55, pine 0.6, palm 0.58, cactus 0.48, shrub 0.37, grass 0.36, reeds 0.43, dunes 1.2. | Caleb: the terrain should be larger next to the plants. |
| Too small to read | Icons narrower than a few screen pixels are not drawn: trees below 4 px, palms and cacti 5, shrubs 7, grass and reeds 8, dunes 9. While a brush stroke is under way, icons under 8 px are left out until it ends, so painting over a big forest stays quick. | Tiny grass turned into dark specks across the whole land. |

### The painterly look

| Item | Choice |
| --- | --- |
| Sea | Blue (Caleb), lighter along the coast (a soft band about 14 units wide). |
| Land | Each cell in its biome's color, blended softly into its neighbors (a blur of about 2.4 map units); land with no biome is a pale ochre. Water cells next to land take that land's color in the hidden color picture, so the blending never pulls a pale fringe into the coast. |
| Paper | The parchment texture shows through the paint (multiplied at 45%), so it reads as paint on paper. |
| Coastline | A thin dark blue-grey line. No wave rings. |
| Icons | The same icons as the atlas, in color. |
| Speed | The biome colors are kept in a picture that is repainted only where land or biomes change, so painting stays quick. In the test browser (no graphics card) a full painterly drawing took about 50 ms and an atlas drawing about 120 ms. |

### The look toggle

| Item | Choice |
| --- | --- |
| Where | **Atlas / Painterly** over the map's top-right corner (moved there in Stage 4, see "Editor layout"). |
| Remembered | Per world, on this computer (not part of the world, so not in exports). Entry pages will follow it (Stage 7). |

## Elevation and terrain icons (Stage 4)

### Elevation

| Item | Choice |
| --- | --- |
| Stored | One height per cell, in whole meters from 0 to 9,000. Land only; water reads 0. |
| New land | Starts at 100 m (low plains). |
| The coast | Elevation never turns land into water or water into land (Caleb): lowering stops at 0 m, and the elevation brush does nothing on water. |
| Brush | **Set** (an exact height), **Raise** and **Lower** (meters per dab at the brush's center, fading to nothing at its rim), **Smooth** (moves heights toward the average of their neighbors). There is no elevation fill. |
| Alt+click | In Elevation mode, picks the height under the cursor into Set. |

### The icons (drawn in code, matched to Caleb's map)

| Item | Choice | Why |
| --- | --- | --- |
| Style | Mountains, hills, volcanoes, plateaus and cliffs in the style of the bonus art pack for Nortantis: bold, slightly uneven ink outlines open at the bottom, rounded tips, close hatching on the shaded right faces and loose strokes on the lit left faces. Trees, palms, cacti, shrubs, grass, dunes and reeds in the style of the FA01-Temperate pack: bold outlines, flat shading in two tones on the shadow side. | Caleb's picks. The packs were only looked at for style; nothing was copied, traced or shipped. The art is the app's own code (`src/lib/map/art`), so the repository's license is unaffected. |
| Why code, not images | AI images (Canva, with three bonus-pack mountains as references) came closest to the pack's look, but repeated one shape, came only as small previews here, and each would have needed downloading by hand. | Caleb compared both and chose the code-drawn ones. |
| Variety | 16 mountain drawings (3 of them spires), 12 hill, 8 volcano, 8 plateau, 8 cliff; 8 to 12 of each plant. Mountains are a main peak with lower peaks behind and smaller ones in front, broad (slopes no steeper than about 50 degrees) and varying in height; hills are knolls, double crests, low ridges or small clusters; plateaus vary in width, tilt and cliff depth, with uneven tops and sometimes a lower tier. | Caleb found the first set too alike. |
| Volcano | A broad cone with a rough rim notched on one side; the inside of the crater is hatched dark, so it reads as a hollow; smoke rises from inside it. | Caleb: the first crater was not shadowed and looked odd. |
| Line weight | One line weight across the map: every icon's lines are set from the width it would have as a mountain. Plants' lines shrink with them, so small trees stay delicate. | |
| See-through | On the atlas an icon hides the icons behind it but lets the land (its texture and coast shading) show through its inside, as on Caleb's map: each drawing has a mask that erases what is behind before it is stamped. On the painterly map terrain is filled with color that fades out toward the ground, so it does not stop at a hard line. | A flat fill made the icons look like cut-outs. |
| Sharp at every zoom | Each drawing is made at a few widths (8 to 1,024 pixels) and stamped at the nearest, scaled. It is always drawn in the same units and scaled, so a mountain looks the same at every zoom. Drawings needed during a redraw are made at once for up to 40 ms; after that a nearby size stands in and the rest are made in the background, then the map redraws. | Zooming in stays smooth. |

### Hills and mountains drawn by the app (taken out)

During Stage 4 the app drew hills (from 500 m) and mountains (from 1,500 m) by itself on high ground: 5.5 cell spacings wide, each scaled by its polygon's width between its neighbors over the map's average as Nortantis does (ratio stretched by 1.21 so sizes varied as much as Nortantis's, kept within 0.45 to 1.9), spaced across a range so neighbors overlapped by about a third. Caleb took this out after trying it on the site: placing a mountain raised the ground, and the app then drew more mountains around it. Only icons placed by hand are drawn now. The sizing and spacing code is in commit `1556a05` (`autoTerrain` in `src/lib/map/terrain.ts`), for random generation (Stage 6) to draw on if wanted.

### Terrain icons placed by hand (icons come before elevation)

| Icon | What it does to the ground around it | Default | Width |
| --- | --- | --- | --- |
| Mountain | Raises it to at least the peak | 2,500 m | 5.5 cell spacings |
| Hill | Raises it to at least the hill's top, falling off softly | 700 m | 2.8 |
| Volcano | The same as a mountain | 3,000 m | 5.8 |
| Plateau | Raises a flat top with steep edges | 1,200 m | 6 |
| Cliff | Raises the ground on the side away from the drop by the drop, fading out at its ends (and toward one end, for a cliff that fades out) | 300 m drop | 4.2 (made a little smaller after Caleb tried it; it was 5) |

- Cliffs step the ground first, then hills, mountains, volcanoes and plateaus raise it, as "at least this high". The polygon right under a hill, mountain or volcano placed by hand reads its full height, and the ground falls off softly around it, whatever was painted there.
- A terrain icon placed by hand stays where Caleb put it. Painting elevation under it never moves or removes it.
- A biome's plants are not drawn under a terrain icon placed by hand (around a hill's, mountain's or volcano's ground point, on a plateau's top, along a cliff), so they do not crowd it.
- **Cliffs** are one side only (Caleb). Their direction is the compass direction the drop faces, one of 8 (south, toward the viewer, for new cliffs; see Stage 5 for the drawings). A drop facing down the map shows a tall hatched rock face with cracks, ledges and loose rock at its foot; facing up the map, only the rim shows, with broken blocks along its lip and no rocks (rocks made it read as facing the viewer). Neither has inked sides: the rim thins out and the face fades at each end, so cliffs placed end to end join into one. Shape (chosen when placing, or later): even, fades out to the left, fades out to the right (as seen with the drop facing you), or broken in two.
- Plants placed by hand (trees, cacti, shrubs, grass, dunes, reeds) are pictures only: they change neither the biome nor the elevation.
- Icons can be placed anywhere on the map, water included, but they only shape land.
- **Dropped:** valleys and passes (Caleb: not needed) and canyons (Caleb: dropped for now; they did not read as precipices, and cliffs cover a drop). `SPEC.md`'s starter set was updated to match, at Caleb's request.

### Icons mode (placing single icons)

| Item | Choice |
| --- | --- |
| Pick | Any terrain icon, or any plant or ground icon (the same drawings as the biome icons), from the panel on the right. The panel shows each one as drawn on the map. |
| Place | With **Place**, click the map. The new icon is selected, so it can be adjusted at once. Clicking an icon placed by hand selects it instead. Each new icon gets one of its kind's drawings at random, and keeps it. |
| Select | With **Select**, click any icon, a biome's plants included (Caleb: each icon can be sized on its own). One of the app's own icons is taken over: it becomes an icon placed by hand, in the same spot, at the same size, with the same drawing, and the app leaves out its own copy. From then on it stays as Caleb leaves it, even if the biome under it changes. Deleting it leaves the spot empty; undo gives it back to the app. Icons too small to see at the current zoom cannot be picked. |
| Settings | Width in km; height or drop in meters (terrain icons); for cliffs and waterfalls, which of the 8 directions it faces, with a small preview; for cliffs, the shape. Set before placing, or edit the selected icon. |
| Move, delete | Drag an icon to move it; `Delete` or `Backspace` removes the selected one; `Escape` lets go. Clicking the map takes focus away from the panel's fields (keeping what was typed), so `Delete` then works on the map. |
| Undo | Placing, taking over, moving, editing and deleting share the undo history with painting. Edits to the same icon less than a second apart (typing a number) are one step. |

### Hover outline

The polygon under the mouse is outlined in red, along its wiggly edges as the map draws them, in every mode.

### Elevation readout and overlay

The spec left the form of the overlay to this stage ("contour lines, shading, or both"). Picked: both, with the shading as colors by height. Caleb kept it as it is; `SPEC.md` updated to match and the open item closed, at his request.

| Item | Choice |
| --- | --- |
| Readout | The height in meters, in the bar under the map, beside the position, land or water, and the biome. |
| Overlay | The **Elevation** button over the map's top-right corner. Land is colored by height, from green lowland through yellow, orange and brown to grey and white at 5,000 m and above. While it is on, these colors cover the biome colors, so the two cannot be confused. |
| Contour lines | Every 250 m, heavier every 1,000 m, along the cells' wiggly edges. |
| Icons | Drawn half see-through while the overlay is on, so the colors show under the mountains. |
| Key | A small color key in the map's bottom-left corner while the overlay is on. |
| Remembered | No: the overlay is off when a world opens. |

### Editor layout

| Item | Choice | Why |
| --- | --- | --- |
| Toolbar | One row at a fixed height; it scrolls sideways if the window is too narrow. | With the elevation tools it wrapped to two rows in some modes, so the map jumped up and down when the mode changed. |
| View controls | The Elevation overlay, Atlas / Painterly and Fit buttons sit over the map's top-right corner. | They are about how the map is shown, not about painting, and this frees the toolbar. |

### Format

- Format version **5** adds the elevation layer (a blob, two bytes per cell), the list of placed icons (ID, kind, position, width, drawing, and a cliff's direction and shape and meters where the kind has them), and the keys of the app's own icons that were taken over. Format 5 had not reached the site when the icons were redone, so it was extended rather than raised.
- A Stage 3 map (format 4) opens with its land at 100 m and no placed icons. A missing elevation layer is not reported as damage.

### Speed

In the test browser (no graphics card), on a map whose land is all forest with a long range (about 29,000 trees and 170 mountains): a full redraw took about 150 to 240 ms, rebuilding the icon list included (about 40 to 45 ms); the first drawing after zooming in a long way, while new sizes are made, up to about 390 ms. A brush stroke over that forest ran at about 17 ms a frame typically and 83 ms at worst, against 117 ms at worst with the first icons. Zooming and panning move the last drawing until they stop, so they stay smooth. A computer with a graphics card draws faster. The height colors, like the painterly colors, are repainted only where heights change.

## Rivers, lakes and waterfalls (Stage 5)

### Rivers

| Item | Choice |
| --- | --- |
| Stored | Each river is its points from source to mouth (map units) and its own width at the mouth. Its smoothed line, its width along the way, where it joins another river, and the waterfalls on it are worked out each time it is drawn, never stored. |
| **Draw** | Drag from the source to the mouth. The river is kept where it was drawn: the stroke is thinned to the points needed to keep its shape (within 0.12 cell spacings) and rounded. A stroke shorter than 1.5 cell spacings adds nothing. Ending it within 0.6 cell spacings of another river joins it there. |
| **Route downhill** | Click where a river starts (on land). The app follows the heightmap down, cell by cell, to the sea, a lake, the map's edge, or another river (joining it once within 0.7 cell spacings). Pits and flat ground are first filled in (as rain would pool and spill over), so every land cell drains somewhere. The line wanders a little between cell centers so it does not look ruled; the same click gives the same river. |
| **Select** | Click a river. The panel gives its width at the mouth (in km, editable), its length, **Flow the other way** (swaps source and mouth) and **Delete** (or `Delete`/`Backspace`); `Escape` or clicking away lets go. A new river is selected once added. |
| Width | A new river is 0.2 cell spacings wide at its mouth by default (5.5 km on a 4,000 km map), set in the panel before drawing. Each river narrows toward its source, to a quarter of its width there. A river that joins another widens it from the join down: widths add as the square root of the sum of their squares, so two equal rivers make one about 1.4 times as wide. |
| Drawn | On land only: rivers stop at the shore (a stroke that runs on into the sea, or across a lake, is not drawn there). Under the icons. Atlas: two thin ink banks with pale water between; painterly: blue water with a darker edge. Very thin rivers are a single line. |
| Plants | A biome's plants are not drawn along rivers. |
| Undo | Adding, routing, editing the width (typing is one step), flowing the other way and deleting share the undo history with painting and icons. |

### Lakes

Painted water inside land (Caleb), with the Land & water tools. Routed rivers end at them as at the sea, and rivers are not drawn across them.

### Waterfalls

| Item | Choice |
| --- | --- |
| By themselves | Where a river crosses a cliff's rim, a waterfall on the rim at the crossing, facing the way the cliff faces, as wide as the larger of 0.4 times the cliff's width and three times the river's width there. They follow the cliff and the river as either changes. |
| By hand | **Waterfall** in Icons mode (under Water), with a width and a direction. |
| Taking over | **Select** takes over a waterfall the app drew, as with a biome's plants: it becomes a placed icon facing the same way, and the app leaves out its own copy. |

### Directions: a drawing per direction (cliffs and waterfalls)

The map is seen from the south and from above, so a face always hangs straight down the page; only the rim's line changes with the direction. Turning the south-facing drawing tipped the face, rocks and water sideways, so each of the 8 directions has its own drawing (Caleb):

| Facing | Cliff | Waterfall |
| --- | --- | --- |
| S | The face hanging below the rim (as before). | The sheet falling between hatched rock (as before). |
| SE, SW | The rim slants; the face hangs below it, leaning a little toward the drop, so less of it shows. | The lip slants; the water falls straight down from it, leaning a little the same way. |
| E, W | The rim runs up and down the page; the face is seen side on, as a narrow band of strokes running down and out toward the drop. | Seen side on: the water pours out over the lip and arcs down toward the drop. |
| N, NE, NW | The rim (slanting on NE and NW) with the face hidden (as N before). | The lip, the river running to it, and mist rising beyond. |

- Picked with 8 buttons laid out as a compass ("Drop faces" for cliffs, "Falls toward" for waterfalls), which replace the 0 to 359° slider.
- The stored angle is unchanged (compass degrees). Cliffs placed before at other angles are drawn, and shape the ground, as the nearest of the 8.
- On the painterly map each drawing's fill fades out across the rim toward the foot of its face (or across the high ground on the near side of a drop facing away).
- "Fades out to the left/right" is still as seen with the drop facing you: on a drop facing away it is the other way round on the page.

### Format

- Format version **6** adds the map's rivers: each with an ID, its points from source to mouth, and its width at the mouth. A Stage 4 map (format 5) opens with no rivers.
- In a file, rivers that make no sense (no ID, an ID used twice, a width not above 0, fewer than two points) are left out; points off the map are moved onto its edge.

### Also fixed

- A click right after an undo or redo could be checked against the icons as they were before it (the list was rebuilt on the next frame), so Select could take over an icon that had just been removed. The list is now rebuilt first.

### Speed

A brush stroke over a forest-covered continent (the Stage 4 measure): about 17 ms a frame typically, 67 ms at worst.

## Random generation (Stage 6)

The generator is the app's own code (`src/lib/map/generate.ts`), using general techniques: plates grown from random cells with ridges where they push together, as described for plate-based map generators (Nortantis's own docs say only that it uses a simple tectonic plate simulation; none of its code was looked at or used), and biomes from temperature and moisture after Whittaker's table, as in Amit Patel's polygon map generation.

### Setup

| Item | Choice |
| --- | --- |
| Where | Map setup only (Caleb): **Start with** open water (as before, the default) or **a generated map**. |
| Preview | **Generate** draws the map whole, by the map's own renderer, in either look. **Generate again** makes a new one with the current settings, as often as wanted; the same polygons are reused for the same size, so it takes about a fifth of a second. Changing the size clears the preview. Nothing is saved until **Keep this map**, which opens the editor in the look shown in the preview. |
| Settings | **Amount of land** (10 to 70%, default 35%), **Continents or islands** (one continent, a few continents (default), islands), **How mountainous** (few, low ranges to many, high ranges; default moderate), **Climate** (cold to hot; default temperate). |
| Stored | A generated map is stored like any other (polygons, land, biomes, elevation, icons, rivers), and from then on edited by hand. The settings and the generation's seed are not kept, and nothing is generated again later. No format change (still 6). |

### What it makes, in order

| Step | Choice |
| --- | --- |
| Land | Landmasses as blobs whose coasts are warped by noise: 1, 2 to 4, or 10 to 19 by the setting, spread over the map. Noise adds bays, peninsulas and small islands. Plates (9, 12 or 18) are grown from random cells at random rates, each drifting its own way; where two push together hard enough (more of them on a more mountainous map) the ground rises in a ridge, so mountains follow ridges; where they pull apart it sinks a little. The sea level is set so exactly the amount of land asked for is above it. Specks of land under about 6 cells go under, and puddles under 8 cells are filled in. Land is kept a little off the map's edge. |
| Elevation | Low along the coast, rising inland to several hundred meters; ranges on the ridges, as high as about 1,000 m (barely mountainous) to 5,000 m (very). |
| Lakes | About one per 1,600 land cells (fewer for islands), 3 to 14 cells each, filling hollows at least 4 cells from the sea and below 1,400 m. |
| Terrain icons | Stored as placed icons (Caleb). Plateaus (none to 4, more on a more mountainous map) on broad high ground away from the ranges. Lines of cliffs (none to 4), 2 to 4 cliffs end to end, facing north or south and fading out at both ends: slanting ones read as streaks, and east- or west-facing ones as thin lines, at the scale of a whole map (any direction can be set by hand). A few volcanoes (up to about 5, more for islands and on a more mountainous map), near a coast on a range, or on islands. Mountains from 1,500 m and hills from 450 m on and around the ranges, each sized by its polygon as Nortantis sizes its own and spaced across a range (the sizing set aside in Stage 4). |
| Rivers | Rain (from the moisture below) runs downhill over the ground as the icons shape it; where about twenty cells' worth has gathered there is a river. Each runs from its source to the sea, the map's edge, or into a bigger river (ending on it); its width at the mouth grows with the water it carries (the largest about 0.45 cell spacings). Water runs through lakes, so rivers flow into a lake and out again, or start at one (rivers are drawn on land only). They are stored like rivers drawn by hand. |
| Biomes | Temperature: from the climate setting (about -6 °C in the middle of the map when cold to 34 °C when hot), about 7 °C colder per 1,000 km northward, and 6.5 °C colder per 1,000 m up. Moisture: from the sea, falling off over about 500 km inland, more near rivers and lakes, less behind high mountains to the west (winds from the west), with noise. Then: ice below -4 °C; tundra below 2 °C; pine forest (tundra if dry) below 8 °C; then by moisture desert (warm and dry), grassland, forest, pine forest (cool and wet), jungle (hot and wet); swamp on warm, wet, low ground near water. Painted with the starter biomes, by name; a lone cell takes its neighbors' biome. |

### Also changed

- The editor's map and the preview share the code that lists every icon to draw (`src/lib/map/scene.ts`).

### Speed

In the test browser: about 0.1 to 0.2 s to generate a map; the first one at a size also makes the polygons (about 0.6 s).

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
