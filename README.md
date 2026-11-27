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
| Map | Set the map's size in kilometers. It is made of 16,000 irregular polygons and starts as open water. Draw land and water with a brush or fill; undo and redo. A readout gives positions in km. |
| Two looks | **Atlas**: a fantasy atlas in ink on parchment, a pale sea and darker olive-tan land, matched to a Nortantis map of Caleb's; biomes show only through icons. **Painterly**: a colorful painted map, blue sea, biome colors blended softly, the same icons in color. Toggle over the map's top-right corner; remembered per world on this computer. |
| Biomes | Starts with a short list of broad biomes (forest, pine forest, jungle, grassland, desert, swamp, tundra, ice). Each has a color and a set of icons (trees, pines, palms, cacti, shrubs, grass, dunes, reeds, or none) drawn in code. Paint them on land with a brush or fill; add, rename, recolor, change icons, delete. |

| Elevation | Every land cell has a height in meters (new land starts at 100 m). Paint it with Set, Raise, Lower and Smooth; the coast stays as painted. Hills and mountains are drawn by themselves on high ground (from 500 m and 1,500 m). The readout shows the height under the mouse; the **Elevation** overlay colors land by height, with contour lines and a key. |
| Icons | Place single icons by hand: hills, mountains, volcanoes, plateaus, valleys, canyons, cliffs and passes, which shape the ground around them, and trees, cacti, shrubs, grass, dunes and reeds. Select, drag, resize, set height or depth, turn (cliffs, canyons, valleys), delete; undo and redo. An icon placed by hand stays where it is put. |
| Hover | The polygon under the mouse is outlined. |

Coming next (Stage 5): rivers, lakes and waterfalls.

### Map controls

| Do | How |
| --- | --- |
| Brush, fill, move the map | `B`, `F`, `H` (or hold `Space` and drag, or drag with the middle button) |
| Swap land and water (and go back to painting land) | `X` |
| Brush size | `[` and `]`, or the slider |
| Zoom | Mouse wheel (or trackpad pinch) |
| Undo, redo | `Ctrl+Z`, `Ctrl+Shift+Z` (or `Ctrl+Y`) |
| Pick land, water, a biome or a height from the map | `Alt`+click |
| Icons mode: delete the selected icon, let go of it | `Delete` (or `Backspace`), `Escape` |

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
  lib/world/     world shape (records, fields, blobs, map), format version, export and import files
  lib/map/       polygons, noisy edges, coastlines, biomes, elevation and terrain, icons, both looks, the painting tools
  lib/           browser storage (IndexedDB), app state and autosave
  map/           map setup, map editor, map canvas, biome panel, icons panel
  pages/         Home (the world list), World
  components/    app frame, dialogs, shared pieces
  graphics/      app icon, Croswell Industries logo
docs/            the builder's decisions
```

Built with React, TypeScript, Vite, Tailwind CSS, vite-plugin-pwa and d3-delaunay (for the polygons). Headings use Norwester by Jamie Wilson (SIL Open Font License, `src/assets/fonts/`).
