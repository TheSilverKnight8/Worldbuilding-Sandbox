# Worldbuilding Sandbox — Design Doc

Personal worldbuilding app, vibecoded with the same workflow as the other vibecoded apps (plan → prototype → escalate, consulting at each step). Most implementation is left to code's judgement. This doc covers what the app is and does, followed by the basic build decisions.

## Why

- Existing tools don't fit:
  - **World Anvil** and other full-featured tools: paid, and not willing to pay.
  - **Azgaar**: too hard to use. Its light sim never informed worldbuilding decisions and could be ignored entirely.
  - **Nortantis**: only a map maker; not good at simulating or building anything other than a map.
  - Other systems felt like they "didn't matter to anything."
- Goal: something like the paid versions of World Anvil, in my own way with my own features. Also a way to see how much can be put in and how much is actually useful.

## General rules

- Private, or at least locally saved.
- Up to 3 worlds; worlds can be deleted.
- Entries have structured fields plus a free-write section. Fields are kept clean: a detail gets a structured field only if the sim reads or changes it, or I would filter or compare by it. Everything else is free write.
- Images can be attached to entries.
- Search across entries.
- Entries can link to each other (nice-to-have).
- Not every node needs a written entry (saves space).
- No bloat: nothing that doesn't help inform my decisions.
- Parametric with manual entry everywhere: anything the sim or the app calculates (happiness, loyalty, faction membership and influence, etc.) can also be set by hand.

## Map

- **Hybrid:** my image (made in Nortantis) is the visual backdrop. The app keeps its own data layer (height, biome) on top.
- **Data layer starts by painting:** land and ocean borders first, then geographical features. Biomes are painted by hand, or seeded and spread organically by the sim. The initial biome spread is instant. Biomes keep shifting during the sim.
- **Terrain model:** painted terrain is the base layer, and node effects sit on top. Terrain changes as nodes are added, changed, moved, or removed.
- **Overlays:** political, cultural, and faction regions can be viewed on top of biomes to see territory. Factions have their own overlay. Borders are derived from settlement territory and constrained by geographical features. Optional painting on top.

### Map items

- **Settlement:** see below. Settlements and other manmade areas affect terrain to a lesser extent.
- **Geographical feature:** natural (mountains, rivers, lakes, caverns, etc.). Each kind has a built-in terrain effect. Size-dependent kinds (e.g. mountains) have a size slider that scales the edit. Biomes differ in how much they resist change.
- **Landmark:** major buildings, ruins, statues, and other non-geographical things that shouldn't be abstracted. Landmarks do not edit terrain.
- **Road:** affects terrain lightly. Matters to the sim by connecting settlements.
- **Info node:** general information not attached to a specific object, e.g. marking non-physical events. Mostly free write. Independent of the timelines.
- **Groups:** features like mountains and roads can be grouped (e.g. a mountain range). A group has its own name and entry. Members keep their own entries. Mainly to save space.

## Entry types and fields

**Settlement**
- Name; nation (or independent); dominant culture (the only culture shown in the main dropdown)
- Demographic breakdown by culture (pie-chart style)
- Population, split into workers and soldiers
- Economy: major exports and imports, average wealth, maximum wealth
- Technology: a level or advancement tier
- Happiness and loyalty toward its nation. Sim-calculated and manually settable. These disappear on independent settlements. They allow rebellions.
- Terrain and biome info is read from the map, not stored.

**Nation**
- Name; dominant culture; government type (affects how policy works)
- Policy: several weighted focuses, which also shape how the sim plays the nation. The sim can change policy, though that should be rare.
- Derived: economy (from settlements), technology (highest settlement), territory and total population, relations (from the diplomacy web).
- A nation's policy derives from its dominant culture and is also influenced by the factions present in it.

**Culture**
- Name; exactly one language; weighted leanings (the same focuses as nations).
- No official branching: cultures have no recorded parent. The sim can still create new cultures.

**Language**
- Stores general rules: common letters or sounds, ones to avoid, typical syllable patterns, stress or emphasis, example names, plus free write.
- Checks names and possibly generates them, for settlements, nations, features, and "names".
- Assigned to cultures and culture-adjacent groups. No regional accents.
- A name never changes when possession changes. It changes only if I edit it.

**Biome**
- Name; resistance to terrain change; major resources; hostility.
- Economy and population are derived from the resources and hostility.

**Resource**
- A fixed list of general raw materials, which I can edit and add custom items to. Includes a manufactured goods category with sub-items (e.g. weapons).
- Each has a technology requirement to harvest (e.g. oil higher than wood or fish).
- Used for biome resources and settlement imports and exports.

**Minor faction / people group** (institutions, etc.)
- Name; type; free write. They organize people and operate as their own little nations, in a sense.
- Policy: weighted focuses. A faction's policies influence the policies of nations.
- Territory: derived the same way as nations (from settlements, constrained by geographical features, optional painting), but on its own overlay, separate from nations and cultures.
- Size: membership plus the number of nations it is present in.
- Influence: varies by faction. Usually determined by size and by overlaps in culture and economy. Factions influence the actions of the settlements, nations, and cultures they overlap with.
- A settlement's happiness and loyalty override faction influence. Happiness is the softer override and loyalty is the harder one.

## Diplomacy

- A web of connections. Nodes: nations, cultures, and minor factions or people groups.
- Strands are mutual. A pair can have more than one strand. Each has a base type plus a free-write section.
- The sim can change the web when something happens.

## Time and timelines

- Real-world calendar and time scale. A day is the smallest unit.
- Time plays in real time, 10 seconds per day by default, and can be sped up or slowed down. No rewinding.
- The sim timeline records everything the sim does.
- I can make as many separate timelines of my own as I like.

## Simulation (optional layer)

- Optional; the app works fully without it. Inspiration: WorldBox (not Azgaar's sim).
- Macro only: groups, settlements, cultures, nations, factions. No individuals.
- I seed everything. After that the sim takes over: it grows, spreads, and develops things, and can create new ones.
- Inputs: biomes, geography (height and features), and my settings. Geographic, cultural, political, and ecological constraints keep it realistic. Dominance and imbalance are acceptable outcomes.
- Its output is tied to the library (cultures, languages, regions) and informs my decisions.
- **Events it produces:** settlement effects, culture effects, rebellions (often accompanied by war), wars and diplomacy changes, policy changes, natural disasters.
- **Natural disasters:** real-world types. The chance of each is set by local ecology. They can change terrain.
- **Autopause:** the sim pauses when a nation, settlement, culture, or faction is created or destroyed, whether I or the sim caused it. Each pause can be turned off.
- **Tuning:** growth rate, constraint strength, and a chaos factor (frequency of major events and overall volatility).
- **Locking:** both settings and individual entries can be locked to preserve a specific identity.
- A successful rebellion ends with the settlement independent.

## Explicitly not wanted

- Family trees
- Rewinding time
- Regional accents
- Culture branching
- A "vassal or tributary" diplomacy type

## Suggested by Claude, reviewed and accepted

- Settlement: a "founded" date. Nation: capital and founded date.
- Policy focus list: Economy, Military, Expansion, Technology, Stability, Culture, Diplomacy.
- Diplomacy base types: Allied, Friendly, Neutral, Tense, Hostile, At war, Trade partner.
- Geographical feature fields: name, kind, size (where it applies), location. Landmark fields: name, kind, location. Road fields: name and the settlements it connects (no road types).
- Timeline event fields: date, title, the entries involved, free write. Entries show the events that involve them.
- Removing or moving a node returns terrain to what I painted (base layer plus node effects).
- The language's "names" scope means personal names. Landmarks are not covered.

## Build decisions (the "how")

Most implementation is left to code's judgement. Decided so far:

- **Platform:** a web app, like the other projects, hosted on GitHub Pages. (A desktop app was considered and set aside.)
- **Storage:** local. No cloud or site database. The mechanism is left to code.
- **Saving:** autosave to local browser storage, plus manual export and import of a world as a file. No backup reminders.
- **Simulation:** included if it fits. If it would make the site too big for GitHub Pages, it is left out.
- **Build order:** macro to micro, with a test checkpoint at the end of each stage:
  1. Foundation: up to 3 worlds, create and delete, autosave, export and import.
  2. Map: image backdrop, painting the data layer (land, ocean, biomes), overlay toggles.
  3. Libraries: biomes, resources, cultures, languages, with their fields.
  4. Map items: settlements, features, landmarks, roads, info nodes, groups, entries with images, search.
  5. Nations, factions, and the diplomacy web, with territory overlays.
  6. Time and timelines.
  7. Simulation, in sub-steps (growth, culture, rebellions and war, disasters, then tuning, locking, and autopause), each tested on its own.
  8. Language tools: name checking and generation. Independent of the others, so it could go earlier.

## Open items

- Placement of the simulation and the language tools in the build order (the order above was accepted as a whole, with these two flexible).
- Data structure: how entries, nodes, and links are shaped. Left to code, but costly to change after material is entered.
