# Worldbuilding-Sandbox
A worldbuilding sandbox

**Worldbuilding Sandbox** is a personal worldbuilding app. It is being built in stages from Caleb's spec ([`SPEC.md`](SPEC.md)). The builder's choices are written down in [`docs/decisions.md`](docs/decisions.md).

It is an installable web app (PWA) for Chrome on a computer, hosted on GitHub Pages. Everything runs in the browser. Worlds are saved in the browser on your computer and nowhere else.

## What is in it

| Area | What it does |
| --- | --- |
| Worlds | Up to 3 worlds. Create one (it asks for a name), open it, delete it (asks to confirm). Creating or importing a fourth is refused with a message to delete one first. |
| Saving | Changes save by themselves half a second after the last edit, in the browser's storage (IndexedDB). The header shows Saving / Saved. The app asks Chrome to keep its storage even when the disk runs low; Home says whether Chrome agreed. |
| Export and import | Export saves a world as one file (`<name>.world.json`), images and map included. Import adds a world from such a file. Files carry a format version, so files exported today still open after the app changes. |
| Map | A grid of cells (1024 on the long side), set up from an image (for example from Nortantis) or blank. Paint land and ocean, biomes, and elevation (set, raise, lower, smooth) with a brush or fill; undo and redo. The app draws the map itself: smooth coastlines, biome colors, ocean depth, relief shading. The image underneath is for tracing and can be replaced or removed. |
| Biomes | Starts with a list of basic land biomes and ocean biomes by depth. Each has a name, land or ocean, and a color you choose; add, rename, recolor or delete them. |
| Layers | Image and the app's map, each with on/off and opacity; biomes and relief shading on/off. |

Coming next (Stage 3): the libraries. Biomes, resources, cultures and languages, with their fields.

### Map controls

| Do | How |
| --- | --- |
| Brush, fill, move | `B`, `F`, `H` (or hold `Space` and drag, or drag with the middle button) |
| Brush size | `[` and `]`, or the slider |
| Zoom | Mouse wheel (or trackpad pinch) |
| Undo, redo | `Ctrl+Z`, `Ctrl+Shift+Z` (or `Ctrl+Y`) |
| Pick from the map | `Alt`+click: land or ocean, the biome, or the elevation, depending on the mode |

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
  lib/map/       map grids, biomes, painting tools, WebGL renderer
  lib/           browser storage (IndexedDB), app state and autosave
  map/           map setup, map editor, canvas, side panels
  pages/         Home (the world list), World
  components/    app frame, dialogs, shared pieces
  graphics/      app icon, Croswell Industries logo
docs/            the builder's decisions
```

Built with React, TypeScript, Vite, Tailwind CSS and vite-plugin-pwa; the map is drawn with WebGL 2. Headings use Norwester by Jamie Wilson (SIL Open Font License, `src/assets/fonts/`).
