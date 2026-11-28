# Worldbuilding-Sandbox
A worldbuilding sandbox

**Worldbuilding Sandbox** is a personal, creative worldbuilding app: a map drawn as a fantasy atlas or a painterly map, with entries, regions, diplomacy, timelines and languages. There is no simulation. It is being built in stages from Caleb's spec ([`SPEC.md`](SPEC.md)); the reasoning behind the spec is in [`docs/concept-rethink.md`](docs/concept-rethink.md), and the builder's choices are written down in [`docs/decisions.md`](docs/decisions.md).

It is an installable web app (PWA) for Chrome on a computer (Mac or Windows), hosted on GitHub Pages. Everything runs in the browser. Worlds are saved in the browser on your computer and nowhere else.

## What is in it

| Area | What it does |
| --- | --- |
| Worlds | Up to 3 worlds. Create one (it asks for a name), open it, delete it (asks to confirm). Creating or importing a fourth is refused with a message to delete one first. |
| Saving | Changes save by themselves half a second after the last edit, in the browser's storage (IndexedDB). The header shows Saving / Saved. The app asks Chrome to keep its storage even when the disk runs low; Home says whether Chrome agreed. |
| Export and import | Export saves a world as one file (`<name>.world.json`), images and map included. Import adds a world from such a file. Files carry a format version, so files exported today still open after the app changes. |
| Map | Set the map's size in kilometers. It is made of 16,000 irregular polygons. Start from open water, or **generate** a map (amount of land, continents or islands, how mountainous, climate) with land, elevation, lakes, terrain icons, rivers and biomes: preview it in either look, generate again until you like one, and keep it. Either way, draw land and water with a brush or fill; undo and redo. A readout gives positions in km. |
| Two looks | **Atlas**: a fantasy atlas in ink on parchment, a pale sea and darker olive-tan land, matched to a Nortantis map of Caleb's; biomes show only through icons. **Painterly**: a colorful painted map, blue sea, biome colors blended softly, the same icons in color. Toggle over the map's top-right corner; remembered per world on this computer. |
| Biomes | Starts with a short list of broad biomes (forest, pine forest, jungle, grassland, desert, swamp, tundra, ice). Each has a color and a set of icons (trees, pines, palms, cacti, shrubs, grass, dunes, reeds, or none) drawn in code. Paint them on land with a brush or fill; add, rename, recolor, change icons, delete. |
| Elevation | Every land cell has a height in meters (new land starts at 100 m). Paint it with Set, Raise, Lower and Smooth; the coast stays as painted. Terrain icons placed by hand shape it; the elevation itself places no icons. The readout shows the height under the mouse; the **Elevation** overlay colors land by height, with contour lines and a key. |
| Rivers | Rivers run along the borders between polygons, as in Nortantis, drawn with the same wiggle as the coasts. **Draw** a river from its source to its mouth (it is moved onto the borders nearest your stroke), or **Route downhill**: click where it starts and the app runs it down the heightmap to the sea, a lake, the map's edge or another river. Rivers narrow toward their source and widen where others join them, and are drawn on land only. **Select** a river to set its width at the mouth, make it flow the other way, or delete it. Lakes are water painted inside land. Where a river goes over a cliff, a waterfall appears (at the shore it falls into the sea or the lake); rivers widen up to a waterfall and narrow again below it. Undo and redo. |
| Cliffs | Cliffs run along the borders between polygons, like rivers. **Draw** one by dragging along where it runs (it is moved onto the borders nearest your stroke; the drop is on the right of the way you drag, and a stroke that ends where it began makes a ring). Where the drop faces you, its rock face hangs below the rim; where it faces away, only the rim shows. The face hides what is behind it, and the ground on the high side is raised by the drop. **Select** a cliff to set its drop, turn the drop the other way, or delete it. Undo and redo. |
| Icons | Drawn in code in an ink style matched to a Nortantis map of Caleb's: mountains, hills, volcanoes and plateaus after the bonus art pack for Nortantis, plants after the FA01-Temperate pack (style references only; no pack art is used). **Place** single icons by hand, one per polygon as in Nortantis (clicking a polygon again rerolls its icon's drawing; another kind replaces it): mountains, hills, volcanoes (sized by their polygon) and plateaus, which shape the ground around them, trees, palms, cacti, shrubs, grass, dunes and reeds, waterfalls, and settlements (farm, village, town, city, walled city, castle, port, ruins), each settlement with its own roof color on the painterly map. **Select** any icon, a biome's plants and the waterfalls on rivers included, to move, resize or delete it; one of the app's own then stays as you leave it. Waterfalls fall toward any of 8 directions, each drawn as seen from that side. Undo and redo. |
| Text | The kinds of text Nortantis has (title, region, mountain range, other mountains, city, lake, river, road), each in its own font, bundled with the app. **Add** text with a click, or drag along a line for text that follows it, then type its words beside the map. **Select** text to move it, change its words (several lines), kind, size and turn, make curved text straight, or delete it. A soft paper-colored edge keeps it readable over icons. Undo and redo. |
| Nodes | An icon or a piece of text can stand for an entry (a settlement, landmark, feature, info node or group). In **Nodes** mode, click one to link it to a new entry or one that exists, open its entry, or unlink it; small marks show which items are nodes. A node moves and is deleted with its icon or text. |
| Hover | The polygon under the mouse is outlined. |
| Entries | A world's second view (**Map** / **Entries** in the header): settlements, nations, cultures, languages, factions, features, landmarks, roads, info nodes, groups and biomes, each with its fields (eras, dates to the day, BC included, kinds you can add to), free write with simple formatting, links to other entries (type [[), a list of what links to it, and a gallery of images with a cover. Search names, text and fields; filter by type and by field. Pages follow the atlas or painterly look, the same as the map. Entries with nodes list them under **On the map**, each with **Show on the map**; settlements, landmarks and features show the biome and elevation at their spot, and the list can be filtered by that elevation. |

Coming next (Stage 8, parts 2 and 3): roads, then decorations (compass rose, scale bar, ships).

### Map controls

| Do | How |
| --- | --- |
| Brush, fill, move the map | `B`, `F`, `H` (or hold `Space` and drag, or drag with the middle button) |
| Swap land and water (and go back to painting land) | `X` |
| Brush size | `[` and `]`, or the slider |
| Zoom | Mouse wheel (or trackpad pinch) |
| Undo, redo | `Ctrl+Z`, `Ctrl+Shift+Z` (or `Ctrl+Y`) |
| Pick land, water, a biome or a height from the map | `Alt`+click |
| Icons mode: place or select | **Place** / **Select** in the toolbar |
| Icons mode: delete the selected icon, let go of it | `Delete` (or `Backspace`), `Escape` |
| Rivers mode: draw, route or select | **Draw** / **Route downhill** / **Select** in the toolbar |
| Rivers mode: delete the selected river, let go of it | `Delete` (or `Backspace`), `Escape` |
| Text mode: add or select | **Add** / **Select** in the toolbar |
| Text mode: delete the selected text, let go of it | `Delete` (or `Backspace`, outside the words box), `Escape` |
| Nodes mode: let go of the picked item | `Escape` |

## Run it on your computer

Needs Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173) in Chrome.

## Put it online (GitHub Pages)

1. The repository must be **public** (Pages is free for public repositories). Only the code is public; your worlds stay in your browser.
2. **Settings > Pages > Build and deployment > Source**: choose **GitHub Actions**.
3. Push to `main`. [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and publishes the app to `https://<your-username>.github.io/<repo-name>/`.

To install it: open the site in Chrome and use the install button in the address bar.

## Where your worlds are

In Chrome's storage for the site's address, on this computer only. The address matters: the published site and `localhost` have separate storage, and so do different browsers or Chrome profiles. To move a world from one to another, export it and import it there.

Clearing Chrome's site data for the address deletes the worlds stored there. An exported file is a full copy of a world, images and map included.

## Project layout

```
src/
  lib/world/     world shape (records, fields, blobs, map), entry types and fields, format version, export and import files
  lib/map/       polygons, noisy edges, coastlines, biomes, elevation and terrain, rivers, cliffs, icons, text, nodes, both looks, the painting tools, the map generator
  lib/map/art/   the icons' drawings, in code (terrain, plants, waterfalls, settlements)
  lib/           browser storage (IndexedDB), app state and autosave
  map/           map setup (open water or generated, with a preview), map editor, map canvas, biome, rivers, cliffs, icons, text and nodes panels
  entries/       the Entries view: list, search and filters, entry pages, free write, field editors, images
  pages/         Home (the world list), World
  components/    app frame, dialogs, shared pieces
  graphics/      app icon, Croswell Industries logo
docs/            the builder's decisions
```

Built with React, TypeScript, Vite, Tailwind CSS, vite-plugin-pwa and d3-delaunay (for the polygons). Headings use Norwester by Jamie Wilson (SIL Open Font License, `src/assets/fonts/`). Map text uses Cinzel Decorative, Cinzel, IM Fell English and IM Fell English SC (SIL Open Font License, from the `@fontsource` packages).
