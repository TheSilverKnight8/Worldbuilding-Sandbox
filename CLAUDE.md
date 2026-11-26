# Notes for Claude Code

`SPEC.md` is Caleb's. It holds what the app does. Follow it and do not add features that are not in it.

- The ideas are Caleb's; the design and implementation are the builder's. When a question is about *what* the app should do and `SPEC.md` does not answer it, ask Caleb before building it. The builder's choices and Caleb's answers are recorded in `docs/decisions.md`; the reasoning behind the spec is in `docs/concept-rethink.md`.
- Build in the stages listed in `SPEC.md` ("Build order"), macro to micro. Each stage ends at a test checkpoint: Caleb tries it before the next stage starts.
- There is no simulation, and none should come back: nothing grows, spreads or changes by itself. Regions are drawn by hand; the diplomacy web changes only by hand.
- Looks come first. The map has two looks of the same world: a fantasy atlas in the style of Nortantis, and a colorful painterly map. Entry pages follow the same toggle.
- Nortantis is AGPL 3.0. Do not copy or port its code or art. Write the app's own versions of the general techniques (Voronoi polygons, Amit Patel's noisy edges), and draw art in code.
- Icons come before elevation: a terrain icon placed by hand stays where Caleb put it, and the elevation under it reads at least that icon's height.
- This project is independent of Caleb's other projects. The only links are the workflow and the visual style of the Engineering Management Portal, Synth Studio and Stickman Arena (cream, navy and red, Norwester headings, staggered stripes) for the app's frame and menus. Light mode only.
- Logo rule (same as the others): the full Croswell Industries logo on Home only; the C mark on every other screen, in the gap left of the bottom stripes.
- Chrome on a computer (Mac and Windows) is the target. There is no phone layout.
- Local only. Worlds live in this browser's IndexedDB (`src/lib/db.ts`) and in files Caleb exports. No accounts, no server, no database. Hosting is GitHub Pages (free).
- Up to 3 worlds (`MAX_WORLDS` in `src/config.ts`). Creating or importing a fourth is refused with a message to delete one first.
- The data shape in `src/lib/world/types.ts` was agreed with Caleb and is costly to change once material is entered: records with an ID and a kind, links by ID only, optional free write and images, blobs stored apart from records. Build on it; ask before changing it.
- Every stored world and every exported file carries `format` and `version`. Changing what is saved means raising `FORMAT_VERSION` in `src/lib/world/format.ts` and teaching `upgrade()` to bring older worlds forward. Never break old worlds or old export files. Version 2 was used by the abandoned `stage-2-map` branch, so the next format is 3 (see `docs/decisions.md`).
- Every change to the open world goes through `updateWorld()` in `src/lib/store.ts`, which saves it.
- `npm run typecheck` and `npm run build` must pass.
