import { useSyncExternalStore } from 'react';
import { MAX_WORLDS } from '../config';
import { addWorld, deleteBlob, deleteWorldData, getBlob, listBlobs, listWorlds, putBlob, readDoc, saveWorld, storageMessage, writeWorld } from './db';
import { newId } from './ids';
import { MAX_BIOMES, biomeFields, biomeRecord, slotFor, withStarterBiomes } from './map/biomes';
import { biomeToBlob, elevationToBlob, gridSizeFor, isLand, layersFromBlobs, newLayers, type MapLayers, type Rect } from './map/grid';
import { FORMAT_VERSION, download, exportFile, exportFileName, readExportFile, readWorld } from './world/format';
import { metaOf, type BiomeFields, type MapInfo, type Realm, type WorldBlob, type WorldDoc, type WorldMeta } from './world/types';

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
    const world = parsed.data;
    let repaired = false;
    if (world.map) {
      const m = world.map;
      const [e, b] = await Promise.all([getBlob(id, m.elevationBlob), getBlob(id, m.biomeBlob)]);
      if (stale()) return;
      const loaded = await layersFromBlobs(m.width, m.height, e?.data, b?.data);
      if (stale()) return;
      layers = loaded.layers;
      repaired = loaded.repaired;
    }
    set({ open: { kind: 'ready', world }, save: { state: 'saved' } });
    emitLayers(null);
    // A world saved by an older version of the app is saved again in the current format.
    if (stored.version < FORMAT_VERSION) markDirty();
    if (repaired) {
      layersDirty = true;
      markDirty();
      set({ notice: 'Part of this map’s painted data could not be read and was reset.' });
    }
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
  layers = null;
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
  // The map grids are saved with the doc, in the same transaction, when they changed.
  const blobs: WorldBlob[] = [];
  const withLayers = layersDirty && layers !== null && doc.map !== null;
  if (withLayers && layers && doc.map) {
    const type = 'application/octet-stream';
    blobs.push({ worldId: doc.id, id: doc.map.elevationBlob, type, data: elevationToBlob(layers.elevation) });
    blobs.push({ worldId: doc.id, id: doc.map.biomeBlob, type, data: biomeToBlob(layers.biome) });
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

// ---------------------------------------------------------------- the map (Stage 2)

// The open world's grids live here, outside React state: painting changes them many
// times a second. The renderer listens for the rectangles that changed.
let layers: MapLayers | null = null;
/** The grids changed since the last save. */
let layersDirty = false;

type LayerListener = (rect: Rect | null) => void;
const layerListeners = new Set<LayerListener>();

/** The open world's grids, or null when it has no map. */
export function getLayers() {
  return layers;
}

/** Calls `fn` with each changed rectangle of cells, or null when the whole map changed. */
export function onLayersChange(fn: LayerListener) {
  layerListeners.add(fn);
  return () => {
    layerListeners.delete(fn);
  };
}

/** Tells the renderer which cells changed. The painting tools call it after every dab. */
export function emitLayers(rect: Rect | null) {
  for (const fn of layerListeners) fn(rect);
}

/** A painting step (stroke, fill, undo) is finished: save the grids. */
export function layersEdited() {
  layersDirty = true;
  updateWorld((d) => ({ ...d }));
}

const openDoc = () => (state.open.kind === 'ready' ? state.open.world : null);

async function imageSize(file: File): Promise<Result<{ width: number; height: number }>> {
  if (file.type && !file.type.startsWith('image/')) return { ok: false, reason: 'This file is not an image. Use a PNG, JPEG or WebP file.' };
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return { ok: true, value: size };
  } catch {
    return { ok: false, reason: 'This file could not be opened as an image. Use a PNG, JPEG or WebP file.' };
  }
}

export type MapStart = { kind: 'image'; file: File } | { kind: 'blank'; width: number; height: number };

/** Sets up the open world's map, from an image (the backdrop) or blank. Adds the starter biomes if the world has none. */
export async function setupMap(start: MapStart): Promise<Result> {
  const doc = openDoc();
  if (!doc || doc.map) return { ok: false, reason: 'This world already has a map.' };
  const worldId = doc.id;
  let backdrop: MapInfo['backdrop'] = null;
  let size: { width: number; height: number };
  if (start.kind === 'image') {
    const img = await imageSize(start.file);
    if (!img.ok) return img;
    backdrop = { blobId: newId(), width: img.value.width, height: img.value.height, fileName: start.file.name };
    size = gridSizeFor(img.value.width, img.value.height);
    try {
      await putBlob({ worldId, id: backdrop.blobId, type: start.file.type || 'image/png', data: start.file });
    } catch (e) {
      return { ok: false, reason: storageMessage(e) };
    }
  } else {
    size = gridSizeFor(start.width, start.height);
  }
  if (openDoc()?.id !== worldId) return { ok: false, reason: 'The world was closed.' };
  const map: MapInfo = { width: size.width, height: size.height, elevationBlob: newId(), biomeBlob: newId(), biomeSlots: [null], backdrop };
  layers = newLayers(size.width, size.height);
  layersDirty = true;
  updateWorld((d) => {
    const r = withStarterBiomes(d, map);
    return { ...r.doc, map: r.map };
  });
  emitLayers(null);
  return { ok: true, value: undefined };
}

/** Puts a new image under the map (or the first one, on a blank map). The painted data stays. Says whether the image's shape differs from the map's, so it is stretched. */
export async function setBackdrop(file: File): Promise<Result<{ stretched: boolean }>> {
  const doc = openDoc();
  if (!doc?.map) return { ok: false, reason: 'This world has no map yet.' };
  const img = await imageSize(file);
  if (!img.ok) return img;
  const worldId = doc.id;
  const blobId = newId();
  try {
    await putBlob({ worldId, id: blobId, type: file.type || 'image/png', data: file });
  } catch (e) {
    return { ok: false, reason: storageMessage(e) };
  }
  const now = openDoc();
  if (now?.id !== worldId || !now.map) return { ok: false, reason: 'The world was closed.' };
  const old = now.map.backdrop;
  updateWorld((d) => (d.map ? { ...d, map: { ...d.map, backdrop: { blobId, width: img.value.width, height: img.value.height, fileName: file.name } } } : d));
  if (old) void deleteBlob(worldId, old.blobId).catch(() => {});
  const mapAspect = now.map.width / now.map.height;
  const imgAspect = img.value.width / img.value.height;
  return { ok: true, value: { stretched: Math.abs(imgAspect - mapAspect) / mapAspect > 0.02 } };
}

/** Removes the image under the map for good. The app's own drawing of the map stays. */
export async function removeBackdrop(): Promise<Result> {
  const doc = openDoc();
  const old = doc?.map?.backdrop;
  if (!doc || !old) return { ok: true, value: undefined };
  updateWorld((d) => (d.map ? { ...d, map: { ...d.map, backdrop: null } } : d));
  await flushSaves();
  try {
    await deleteBlob(doc.id, old.blobId);
  } catch {
    // Left over in storage; harmless.
  }
  return { ok: true, value: undefined };
}

/** Reads the backdrop image of the open world. */
export async function backdropBlob(): Promise<Blob | null> {
  const doc = openDoc();
  const b = doc?.map?.backdrop;
  if (!doc || !b) return null;
  const found = await getBlob(doc.id, b.blobId).catch(() => undefined);
  return found?.data ?? null;
}

// ---------------------------------------------------------------- biomes (Stage 2: name, land or ocean, color)

/** Sets every cell painted with `slot` back to no biome. Returns whether any changed. */
function clearSlot(slot: number) {
  if (!layers || slot <= 0) return false;
  let changed = false;
  const b = layers.biome;
  for (let i = 0; i < b.length; i++)
    if (b[i] === slot) {
      b[i] = 0;
      changed = true;
    }
  return changed;
}

export function addBiome(name: string, realm: Realm, color: string): Result<string> {
  const doc = openDoc();
  if (!doc) return { ok: false, reason: 'No world is open.' };
  const count = Object.values(doc.records).filter((r) => r.kind === 'biome').length;
  if (count >= MAX_BIOMES) return { ok: false, reason: `A map can hold up to ${MAX_BIOMES} biomes.` };
  const r = biomeRecord(name.trim() || 'New biome', realm, color);
  let map = doc.map;
  if (map) {
    const s = slotFor(map, r.id);
    if (!s) return { ok: false, reason: `A map can hold up to ${MAX_BIOMES} biomes.` };
    map = s.map;
  }
  updateWorld((d) => ({ ...d, records: { ...d.records, [r.id]: r }, map }));
  return { ok: true, value: r.id };
}

export function updateBiome(id: string, patch: { name?: string } & Partial<BiomeFields>) {
  const doc = openDoc();
  const r = doc?.records[id];
  if (!doc || !r || r.kind !== 'biome') return;
  const before = biomeFields(r);
  const fields = { ...r.fields, ...(patch.realm ? { realm: patch.realm } : {}), ...(patch.color ? { color: patch.color } : {}) };
  const name = patch.name !== undefined ? patch.name.trim() || r.name : r.name;
  // A biome moved between land and ocean no longer fits the cells it was painted on.
  if (patch.realm && patch.realm !== before.realm && doc.map) {
    if (clearSlot(doc.map.biomeSlots.indexOf(id))) {
      layersDirty = true;
      emitLayers(null);
    }
  }
  updateWorld((d) => ({ ...d, records: { ...d.records, [id]: { ...r, name, fields } } }));
}

/** Deletes a biome. Cells painted with it go back to no biome. */
export function deleteBiome(id: string) {
  const doc = openDoc();
  if (!doc?.records[id]) return;
  let map = doc.map;
  if (map) {
    const slot = map.biomeSlots.indexOf(id);
    if (slot > 0) {
      if (clearSlot(slot)) {
        layersDirty = true;
        emitLayers(null);
      }
      const slots = [...map.biomeSlots];
      slots[slot] = null;
      map = { ...map, biomeSlots: slots };
    }
  }
  updateWorld((d) => {
    const records = { ...d.records };
    delete records[id];
    return { ...d, records, map };
  });
}

/** Whether a cell can take a biome of this realm. */
export const fitsRealm = (elevation: number, realm: Realm) => (realm === 'land') === isLand(elevation);
