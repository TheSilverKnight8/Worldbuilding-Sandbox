import { useSyncExternalStore } from 'react';
import { MAX_WORLDS } from '../config';
import { addWorld, deleteWorldData, getBlob, listBlobs, listWorlds, putBlob, readDoc, saveWorld, storageMessage, writeWorld } from './db';
import { newId } from './ids';
import { MAX_BIOMES, biomeRecord, seedBiomes, slotFor } from './map/biomes';
import { DEFAULT_CELLS, elevationFromBlob, elevationToBlob, generateGraph, graphFromBlob, graphToBlob, landFromBlob, landToBlob, mapUnitsFor, type Graph } from './map/graph';
import { DEFAULT_LAND_ELEVATION } from './map/terrain';
import { newSeed } from './rng';
import { FORMAT_VERSION, download, exportFile, exportFileName, readExportFile, readWorld } from './world/format';
import { metaOf, type BiomeFields, type IconSet, type MapInfo, type PlacedIcon, type WorldBlob, type WorldDoc, type WorldMeta } from './world/types';

export interface SaveStatus {
  state: 'saved' | 'saving' | 'error';
  message?: string;
}

/** The world on screen, if any. Only one world is open at a time. */
export type OpenWorld =
  | { kind: 'none' }
  | { kind: 'loading'; id: string }
  | { kind: 'ready'; world: WorldDoc }
  | { kind: 'missing'; id: string }
  /** Open in another tab or window of the app, which would overwrite changes made here. */
  | { kind: 'elsewhere'; id: string }
  | { kind: 'error'; id: string; message: string };

export interface StorageInfo {
  /** Whether Chrome has agreed to keep this site's storage when the disk runs low. null: not known. */
  persisted: boolean | null;
  /** Bytes used by this site, as the browser reports it. */
  usage: number | null;
}

export interface AppState {
  boot: { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };
  /** Oldest first, so each world keeps its slot. */
  worlds: WorldMeta[];
  open: OpenWorld;
  save: SaveStatus;
  storage: StorageInfo;
  /** A message about the open world, shown until dismissed. */
  notice: string | null;
}

let state: AppState = {
  boot: { kind: 'loading' },
  worlds: [],
  open: { kind: 'none' },
  save: { state: 'saved' },
  storage: { persisted: null, usage: null },
  notice: null,
};

export function dismissNotice() {
  set({ notice: null });
}

const listeners = new Set<() => void>();
function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function getState() {
  return state;
}

/** Reads part of the app state and re-renders when it changes. The selector must return something already in the state (not a new object). */
export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

const byCreated = (a: WorldMeta, b: WorldMeta) => a.createdAt.localeCompare(b.createdAt);

function setWorldMeta(meta: WorldMeta) {
  const rest = state.worlds.filter((w) => w.id !== meta.id);
  set({ worlds: [...rest, meta].sort(byCreated) });
}

// ---------------------------------------------------------------- start

export async function initApp() {
  try {
    const worlds = await listWorlds();
    set({ boot: { kind: 'ready' }, worlds: worlds.sort(byCreated) });
  } catch (e) {
    set({ boot: { kind: 'error', message: storageMessage(e) } });
    return;
  }
  void refreshStorage();
}

/**
 * Asks Chrome to keep this site's storage even when the disk runs low (persistent
 * storage). Chrome decides on its own whether to agree; asking again later can change
 * the answer. Also reads how much space the site uses.
 */
export async function refreshStorage() {
  const s = navigator.storage;
  if (!s) return;
  try {
    let persisted = s.persisted ? await s.persisted() : null;
    if (!persisted && state.worlds.length > 0 && s.persist) persisted = await s.persist();
    const estimate = s.estimate ? await s.estimate() : undefined;
    set({ storage: { persisted, usage: estimate?.usage ?? null } });
  } catch {
    // Unknown; the line on Home just says less.
  }
}

// ---------------------------------------------------------------- worlds

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; reason: string; full?: boolean };

const FULL = `There are already ${MAX_WORLDS} worlds, the most the app holds. Delete one first.`;

export async function createWorld(name: string): Promise<Result<string>> {
  if (state.worlds.length >= MAX_WORLDS) return { ok: false, reason: FULL, full: true };
  const now = new Date().toISOString();
  const doc: WorldDoc = { id: newId(), name: name.trim() || 'Untitled world', createdAt: now, updatedAt: now, records: {}, map: null };
  try {
    await writeWorld(metaOf(doc), { id: doc.id, version: FORMAT_VERSION, doc });
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
  setWorldMeta(metaOf(doc));
  void refreshStorage();
  return { ok: true, value: doc.id };
}

export async function deleteWorld(id: string): Promise<Result> {
  const o = state.open;
  if (o.kind !== 'none' && (o.kind === 'ready' ? o.world.id : o.id) === id) await closeWorld();
  try {
    await deleteWorldData(id);
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
  set({ worlds: state.worlds.filter((w) => w.id !== id) });
  void refreshStorage();
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------- the open world

let openToken = 0;
let releaseLock: (() => void) | null = null;

/**
 * Holds a lock on the world while it is open, so the same world cannot be open in two
 * tabs or windows at once (each would save over the other's changes). Resolves to the
 * function that lets go of it, or null if another tab holds it. It waits a moment first,
 * because a lock let go of a moment ago (leaving and reopening the same world) can take
 * a little while to become free.
 */
function lockWorld(id: string): Promise<(() => void) | null> {
  if (!navigator.locks) return Promise.resolve(() => {});
  return new Promise((acquired) => {
    navigator.locks
      .request(`world:${id}`, { signal: AbortSignal.timeout(1500) }, () => new Promise<void>((release) => acquired(release)))
      .catch(() => acquired(null));
  });
}

function unlock() {
  releaseLock?.();
  releaseLock = null;
}

export async function openWorld(id: string) {
  const o = state.open;
  if (o.kind === 'ready' && o.world.id === id) return;
  await closeWorld();
  const token = ++openToken;
  // Another world was asked for (or this one closed) while this one was loading.
  const stale = () => token !== openToken;
  set({ open: { kind: 'loading', id } });
  const release = await lockWorld(id);
  if (!release) {
    if (!stale()) set({ open: { kind: 'elsewhere', id } });
    return;
  }
  if (stale()) return release();
  releaseLock = release;
  try {
    const stored = await readDoc(id);
    if (stale()) return; // closeWorld has already let go of the lock
    if (!stored) {
      unlock();
      return set({ open: { kind: 'missing', id } });
    }
    const parsed = readWorld(stored.doc, stored.version);
    if (!parsed.ok) {
      unlock();
      return set({ open: { kind: 'error', id, message: parsed.reason } });
    }
    let world = parsed.data;
    let lostMap = false;
    let seeded = false;
    if (world.map) {
      const loaded = await loadMap(id, world.map);
      if (stale()) return;
      if (loaded) mapData = loaded.data;
      else {
        // The map's stored data is unreadable. Show the setup screen rather than a broken map.
        world = { ...world, map: null };
        lostMap = true;
      }
      if (loaded?.reset) {
        layersDirty = true;
        lostMap = true;
      }
    }
    // A map from before Stage 3 gets the starter biomes, once.
    if (world.map && !world.map.biomesSeeded) {
      const s = seedBiomes(world, world.map);
      world = { ...s.doc, map: s.map };
      seeded = true;
    }
    set({ open: { kind: 'ready', world }, save: { state: 'saved' } });
    emitMap('all');
    // A world saved by an older version of the app is saved again in the current format.
    if (stored.version < FORMAT_VERSION || lostMap || seeded) markDirty();
    if (lostMap) set({ notice: 'Part of this map’s stored data could not be read and was reset.' });
  } catch (e) {
    if (stale()) return;
    unlock();
    set({ open: { kind: 'error', id, message: storageMessage(e) } });
  }
}

export async function closeWorld() {
  openToken++;
  await flushSaves();
  unlock();
  mapData = null;
  layersDirty = false;
  if (state.open.kind !== 'none') set({ open: { kind: 'none' }, notice: null });
}

/** Changes the open world. Every change goes through here, and saves by itself. */
export function updateWorld(fn: (doc: WorldDoc) => WorldDoc) {
  const o = state.open;
  if (o.kind !== 'ready') return;
  const next = fn(o.world);
  if (next === o.world) return;
  const world = { ...next, updatedAt: new Date().toISOString() };
  set({ open: { kind: 'ready', world } });
  setWorldMeta(metaOf(world));
  markDirty();
}

// ---------------------------------------------------------------- saving

// Changes save by themselves half a second after the last edit.
let dirty = false;
let timer: number | undefined;
let flushing: Promise<void> | null = null;

function markDirty() {
  dirty = true;
  set({ save: { state: 'saving' } });
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flushSaves(), 500);
}

export function flushSaves(): Promise<void> {
  window.clearTimeout(timer);
  if (flushing) return flushing.then(() => (dirty ? flushSaves() : undefined));
  const o = state.open;
  if (!dirty || o.kind !== 'ready') return Promise.resolve();
  const doc = o.world;
  // The map's land and biomes save with the doc, in the same transaction, when they changed.
  const blobs: WorldBlob[] = [];
  const withLayers = layersDirty && mapData !== null && doc.map !== null;
  if (withLayers && mapData && doc.map) {
    const type = 'application/octet-stream';
    blobs.push({ worldId: doc.id, id: doc.map.landBlob, type, data: landToBlob(mapData.land) });
    blobs.push({ worldId: doc.id, id: doc.map.biomeBlob, type, data: landToBlob(mapData.biome) });
    blobs.push({ worldId: doc.id, id: doc.map.elevationBlob, type, data: elevationToBlob(mapData.elevation) });
  }
  dirty = false;
  layersDirty = false;
  flushing = (async () => {
    try {
      await saveWorld(metaOf(doc), { id: doc.id, version: FORMAT_VERSION, doc }, blobs);
      set({ save: { state: dirty ? 'saving' : 'saved' } });
    } catch (e) {
      dirty = true;
      if (withLayers) layersDirty = true;
      set({ save: { state: 'error', message: storageMessage(e) } });
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

export function hasUnsavedChanges() {
  return dirty || flushing !== null;
}

// ---------------------------------------------------------------- export and import

export async function exportWorld(id: string): Promise<Result> {
  const o = state.open;
  if (o.kind === 'ready' && o.world.id === id) await flushSaves();
  try {
    const stored = await readDoc(id);
    if (!stored) return { ok: false, reason: 'The world was not found in storage.' };
    const parsed = readWorld(stored.doc, stored.version);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    const blobs = await listBlobs(id);
    download(await exportFile(parsed.data, blobs), exportFileName(parsed.data.name));
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
}

/** Adds a world from an exported file. Refused when all slots are full. */
export async function importWorld(file: File): Promise<Result<WorldMeta>> {
  if (state.worlds.length >= MAX_WORLDS) return { ok: false, reason: FULL, full: true };
  const read = await readExportFile(file);
  if (!read.ok) return { ok: false, reason: read.reason };
  if (state.worlds.length >= MAX_WORLDS) return { ok: false, reason: FULL, full: true };
  let doc = read.data.doc;
  // The same world is already here (e.g. imported twice): the file becomes a separate copy.
  if (state.worlds.some((w) => w.id === doc.id)) doc = { ...doc, id: newId() };
  const meta = metaOf(doc);
  try {
    await addWorld(
      meta,
      { id: doc.id, version: FORMAT_VERSION, doc },
      read.data.blobs.map((b) => ({ ...b, worldId: doc.id })),
    );
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
  setWorldMeta(meta);
  void refreshStorage();
  return { ok: true, value: meta };
}

// ---------------------------------------------------------------- the map (Stages 2 and 3)

// The open world's polygons, land and biomes live here, outside React state: painting
// changes them many times a second. The renderer listens for changes.
export interface MapData {
  graph: Graph;
  /** One byte per cell: 1 = land, 0 = water. Changed in place by the painting tools. */
  land: Uint8Array;
  /** One byte per cell: an index into MapInfo.biomeSlots (0 = no biome). Only land cells have biomes. */
  biome: Uint8Array;
  /** The painted base elevation in meters per cell (Stage 4). Only land cells count. Terrain icons shape it further (see lib/map/terrain.ts). */
  elevation: Int16Array;
}

let mapData: MapData | null = null;
/** The land or biomes changed since the last save. */
let layersDirty = false;

/** 'land': cells changed land or water. 'biome': cells changed biome. 'elevation': the painted elevation changed. 'all': a different map (opened, set up, closed) or a biome deleted. */
export type MapChange = 'land' | 'biome' | 'elevation' | 'all';
type MapListener = (change: MapChange) => void;
const mapListeners = new Set<MapListener>();

/** The open world's map data, or null when it has no map. */
export function getMap() {
  return mapData;
}

export function onMapChange(fn: MapListener) {
  mapListeners.add(fn);
  return () => {
    mapListeners.delete(fn);
  };
}

/** Tells the renderer the map changed. The painting tools call it after every dab. */
export function emitMap(change: MapChange) {
  for (const fn of mapListeners) fn(change);
}

/** A painting step (stroke, fill, undo) is finished: save the land and biomes. */
export function mapEdited() {
  layersDirty = true;
  updateWorld((d) => ({ ...d }));
}

async function loadMap(worldId: string, m: MapInfo): Promise<{ data: MapData; reset: boolean } | null> {
  const [g, l, b, e] = await Promise.all([getBlob(worldId, m.graphBlob), getBlob(worldId, m.landBlob), getBlob(worldId, m.biomeBlob), getBlob(worldId, m.elevationBlob)]);
  const graph = g ? await graphFromBlob(g.data) : null;
  if (!graph || graph.cellCount !== m.cellCount) return null;
  const n = graph.cellCount;
  const land = (await landFromBlob(l?.data, n)) ?? null;
  // A map from before Stage 3 has no biome grid, and one from before Stage 4 no elevation: that is expected, not damage.
  const biome = b ? await landFromBlob(b.data, n) : new Uint8Array(n);
  let elevation = e ? await elevationFromBlob(e.data, n) : null;
  const elevationDamaged = !!e && !elevation;
  const landOk = land ?? new Uint8Array(n);
  if (!elevation) {
    // Land with no elevation yet starts as low plains.
    elevation = new Int16Array(n);
    for (let c = 0; c < n; c++) if (landOk[c]) elevation[c] = DEFAULT_LAND_ELEVATION;
  }
  return { data: { graph, land: landOk, biome: biome ?? new Uint8Array(n), elevation }, reset: !land || !biome || elevationDamaged };
}

/** Limits for a map's size, in kilometers. */
export const MAP_KM_MIN = 10;
export const MAP_KM_MAX = 40000;
/** The long side may be at most this many times the short side, so polygons stay even. */
export const MAP_MAX_ASPECT = 4;

export function checkMapSize(widthKm: number, heightKm: number): string | null {
  if (!Number.isFinite(widthKm) || !Number.isFinite(heightKm)) return 'Enter a width and a height.';
  if (widthKm < MAP_KM_MIN || heightKm < MAP_KM_MIN) return `Each side must be at least ${MAP_KM_MIN} km.`;
  if (widthKm > MAP_KM_MAX || heightKm > MAP_KM_MAX) return `Each side can be at most ${MAP_KM_MAX.toLocaleString()} km.`;
  if (Math.max(widthKm, heightKm) / Math.min(widthKm, heightKm) > MAP_MAX_ASPECT) return `The long side can be at most ${MAP_MAX_ASPECT} times the short side.`;
  return null;
}

/** Sets up the open world's map: a new polygon graph of the given size in km, all water, with the starter biomes. */
export async function setupMap(widthKm: number, heightKm: number): Promise<Result> {
  const doc = state.open.kind === 'ready' ? state.open.world : null;
  if (!doc || doc.map) return { ok: false, reason: 'This world already has a map.' };
  const problem = checkMapSize(widthKm, heightKm);
  if (problem) return { ok: false, reason: problem };
  const worldId = doc.id;
  // Let the screen show that the map is being made before the heavy work starts.
  await new Promise((r) => window.setTimeout(r, 30));
  const units = mapUnitsFor(widthKm, heightKm);
  const seed = newSeed();
  const graph = generateGraph(units.width, units.height, DEFAULT_CELLS, seed);
  const landBlob = newId();
  const map: MapInfo = {
    widthKm,
    heightKm,
    width: units.width,
    height: units.height,
    cellCount: graph.cellCount,
    seed,
    graphBlob: newId(),
    landBlob,
    biomeBlob: `${landBlob}-biomes`,
    biomeSlots: [null],
    biomesSeeded: false,
    elevationBlob: `${landBlob}-elevation`,
    icons: [],
    hiddenAuto: [],
  };
  try {
    // The polygons are written once, now; land and biomes save with the world from here on.
    await putBlob({ worldId, id: map.graphBlob, type: 'application/octet-stream', data: graphToBlob(graph) });
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
  if (state.open.kind !== 'ready' || state.open.world.id !== worldId) return { ok: false, reason: 'The world was closed.' };
  mapData = { graph, land: new Uint8Array(graph.cellCount), biome: new Uint8Array(graph.cellCount), elevation: new Int16Array(graph.cellCount) };
  layersDirty = true;
  updateWorld((d) => {
    const s = seedBiomes(d, map);
    return { ...s.doc, map: s.map };
  });
  emitMap('all');
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------- biomes (Stage 3)

const openDoc = () => (state.open.kind === 'ready' ? state.open.world : null);

export function addBiome(name: string, color: string, icons: IconSet): Result<string> {
  const doc = openDoc();
  if (!doc) return { ok: false, reason: 'No world is open.' };
  if (Object.values(doc.records).filter((r) => r.kind === 'biome').length >= MAX_BIOMES) return { ok: false, reason: `A world can hold up to ${MAX_BIOMES} biomes.` };
  const r = biomeRecord(name.trim() || 'New biome', color, icons);
  let map = doc.map;
  if (map) {
    const s = slotFor(map, r.id);
    if (!s) return { ok: false, reason: `A world can hold up to ${MAX_BIOMES} biomes.` };
    map = s.map;
  }
  updateWorld((d) => ({ ...d, records: { ...d.records, [r.id]: r }, map }));
  return { ok: true, value: r.id };
}

export function updateBiome(id: string, patch: { name?: string } & Partial<BiomeFields>) {
  const r = openDoc()?.records[id];
  if (!r || r.kind !== 'biome') return;
  const fields = { ...r.fields, ...(patch.color ? { color: patch.color } : {}), ...(patch.icons ? { icons: patch.icons } : {}) };
  const name = patch.name !== undefined ? patch.name.trim() || r.name : r.name;
  updateWorld((d) => ({ ...d, records: { ...d.records, [id]: { ...r, name, fields } } }));
}

/** Deletes a biome. Cells painted with it go back to no biome. */
export function deleteBiome(id: string) {
  const doc = openDoc();
  if (!doc?.records[id]) return;
  let map = doc.map;
  if (map && mapData) {
    const slot = map.biomeSlots.indexOf(id);
    if (slot > 0) {
      const b = mapData.biome;
      for (let i = 0; i < b.length; i++) if (b[i] === slot) b[i] = 0;
      const slots = [...map.biomeSlots];
      slots[slot] = null;
      map = { ...map, biomeSlots: slots };
      layersDirty = true;
    }
  }
  updateWorld((d) => {
    const records = { ...d.records };
    delete records[id];
    return { ...d, records, map };
  });
  // 'all' also clears the undo history, which could otherwise paint the deleted biome's slot back.
  emitMap('all');
}

// ---------------------------------------------------------------- icons placed by hand (Stage 4)

/** Replaces the open map's placed icons (placing, moving, editing, deleting all go through here; undo keeps the arrays). */
/** Sets the icons placed by hand, and (if given) the keys of the app's own icons that were taken over. */
export function setPlacedIcons(icons: PlacedIcon[], hiddenAuto?: string[]) {
  updateWorld((d) => (d.map ? { ...d, map: { ...d.map, icons, hiddenAuto: hiddenAuto ?? d.map.hiddenAuto } } : d));
}
