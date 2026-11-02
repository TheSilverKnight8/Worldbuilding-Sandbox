# Decisions made by Claude Code

The spec leaves most of the implementation to Claude Code ("Most implementation is left to code's judgement"). Each choice is written down here so Caleb can read it, test it and change it. Anything about *what* the app does that is not here or in `SPEC.md` was asked first.

## Build stages (from the spec, agreed with Caleb)

Macro to micro, with a test checkpoint at the end of each stage.

1. Foundation: up to 3 worlds, create and delete, autosave, export and import. **(this stage)**
2. Map: image backdrop, painting the data layer (land, ocean, biomes), overlay toggles.
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
| Inside a world | A full-screen work area (like Synth Studio's editors) with a slim stripe and the C mark at the bottom. In Stage 1 it only shows the world's name and creation date; the map comes in Stage 2. |

## Export and import (Stage 1)

| Item | Choice |
| --- | --- |
| File | One file per world, named after it: `<name>.world.json`. JSON text with `format`, `version`, the export date, the world, and its images (as Base64 text, which makes them about a third bigger in the file than in storage). |
| Where it goes | Chrome's downloads (the Downloads folder, or wherever Chrome asks, if it is set to ask). |
| Reading a file | Checks the format and version. A file from a newer version of the app is refused with the reason. A damaged record is skipped rather than refusing the whole file. |
| All 3 slots full | Refused, with a message to delete a world first (Caleb's answer). Creating a fourth world is refused the same way. |
| The same world already in the app | An imported world keeps its ID. If that ID is already in the app (for example, the same file imported twice), the import becomes a separate copy with a new ID and the same name. |

## Data structure (agreed with Caleb)

In `src/lib/world/types.ts`. Settled in Stage 1 because it is costly to change once material is entered.

- Everything in a world is a **record** with an ID and a kind: settlement, feature, landmark, road, info node, group, biome, resource, culture, language, nation, faction, diplomacy strand, timeline, event.
- Records point at each other **only by ID**. Renaming never breaks a link, and a name only changes when Caleb edits it.
- **Structured fields** live on the record. Each kind's fields are added in the stage that builds it, following the spec's rule (a field only if the sim reads or changes it, or it gets filtered or compared).
- **Free write, images and links are optional.** A map node nobody wrote up is only its fields and location.
- **Anything the app or the simulation works out can also be set by hand** (`Settable`): `auto` is the worked-out value, `manual` is set by hand, and `manual` wins when it is present.
- **Locking:** each record has a `locked` flag the simulation must respect.
- **Blobs** (attached images, the map backdrop, map layers) are stored apart from the records, and records refer to them by blob ID.
- Every stored world and exported file has a **format version**. When the shape changes, `upgrade()` in `src/lib/world/format.ts` brings older worlds and files forward.

## Look

- The portal's, Synth Studio's and Stickman Arena's style: cream, navy and red; Norwester headings; Archivo body text; staggered stripes; flat cards. Light mode only.
- Logo: the full Croswell Industries logo on Home; the C mark in the gap left of the bottom stripes inside a world.
- App icon: a cream landmass with a bay, a small islet and a red map pin, on navy.
