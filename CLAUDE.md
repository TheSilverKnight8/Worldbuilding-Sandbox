# Notes for Claude Code

`SPEC.md` is Caleb's. It holds what the app does. Follow it and do not add features that are not in it.

- The ideas are Caleb's; the design and implementation are the builder's. When a question is about *what* the app should do and `SPEC.md` does not answer it, ask Caleb before building it. The builder's choices and Caleb's answers are recorded in `docs/decisions.md`.
- Build in the stages listed in `docs/decisions.md`, macro to micro. Each stage ends at a test checkpoint: Caleb tries it before the next stage starts.
- This project is independent of Caleb's other projects. The only links are the workflow and the visual style of the Engineering Management Portal, Synth Studio and Stickman Arena (cream, navy and red, Norwester headings, staggered stripes). Light mode only.
- Logo rule (same as the others): the full Croswell Industries logo on Home only; the C mark on every other screen, in the gap left of the bottom stripes.
- Chrome on a computer is the target (Caleb's answer). There is no phone layout.
- Local only. Worlds live in this browser's IndexedDB (`src/lib/db.ts`) and in files Caleb exports. No accounts, no server, no database. Hosting is GitHub Pages (free).
- Up to 3 worlds (`MAX_WORLDS` in `src/config.ts`). Creating or importing a fourth is refused with a message to delete one first.
- The data shape in `src/lib/world/types.ts` was agreed with Caleb and is costly to change once material is entered: records with an ID and a kind, links by ID only, optional free write and images, `Settable` for anything the app or the simulation works out, blobs stored apart from records. Build on it; ask before changing it.
- Every stored world and every exported file carries `format` and `version`. Changing what is saved means raising `FORMAT_VERSION` in `src/lib/world/format.ts` and teaching `upgrade()` to bring older worlds forward. Never break old worlds or old export files.
- Every change to the open world goes through `updateWorld()` in `src/lib/store.ts`, which saves it.
- `npm run typecheck` and `npm run build` must pass.
