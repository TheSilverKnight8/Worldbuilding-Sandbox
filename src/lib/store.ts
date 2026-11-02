import { useSyncExternalStore } from 'react';
import { MAX_WORLDS } from '../config';
import { addWorld, deleteWorldData, listBlobs, listWorlds, readDoc, storageMessage, writeWorld } from './db';
import { newId } from './ids';
import { FORMAT_VERSION, download, exportFile, exportFileName, readExportFile, readWorld } from './world/format';
import { metaOf, type WorldDoc, type WorldMeta } from './world/types';

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
}

let state: AppState = {
  boot: { kind: 'loading' },
  worlds: [],
  open: { kind: 'none' },
  save: { state: 'saved' },
  storage: { persisted: null, usage: null },
};

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
  const doc: WorldDoc = { id: newId(), name: name.trim() || 'Untitled world', createdAt: now, updatedAt: now, records: {} };
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
    set({ open: { kind: 'ready', world: parsed.data }, save: { state: 'saved' } });
    // A world saved by an older version of the app is saved again in the current format.
    if (stored.version < FORMAT_VERSION) markDirty();
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
  if (state.open.kind !== 'none') set({ open: { kind: 'none' } });
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
  dirty = false;
  flushing = (async () => {
    try {
      await writeWorld(metaOf(doc), { id: doc.id, version: FORMAT_VERSION, doc });
      set({ save: { state: dirty ? 'saving' : 'saved' } });
    } catch (e) {
      dirty = true;
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
