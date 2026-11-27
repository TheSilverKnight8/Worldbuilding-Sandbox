import { CLIFF_SHAPES, ICON_KINDS, RECORD_KINDS, type CliffShape, type FieldValue, type IconKind, type MapInfo, type PlacedIcon, type RecordKind, type River, type WorldBlob, type WorldDoc, type WorldRecord } from './types';

// Every world carries a format version, both in this browser's storage and in an
// exported file. When the shape of a world changes, FORMAT_VERSION goes up and
// `upgrade` learns to bring older worlds forward, so a world saved today, or a file
// exported today, still opens later. Never break old worlds.
//
// Versions:
//   1  Stage 1: worlds and records.
//   2  Only on the abandoned `stage-2-map` branch: a square-grid map (no longer used).
//   3  Stage 2: the polygon map (WorldDoc.map), with its polygons and land as blobs.
//   4  Stage 3: biomes on the map (a biome grid blob and biome slots).
//   5  Stage 4: elevation (a base elevation blob) and icons placed by hand.
//   6  Stage 5: rivers.

export const FORMAT = 'worldbuilding-sandbox-world';
export const FORMAT_VERSION = 6;

/** The file extension for exported worlds. They are JSON text. */
export const FILE_SUFFIX = '.world.json';

export type Parsed<T> = { ok: true; data: T } | { ok: false; reason: string };

/** Brings an older world up to the current format, one version at a time. */
function upgrade(raw: Record<string, unknown>, from: number): Record<string, unknown> {
  let o = raw;
  // 1 -> 3: Stage 1 worlds have no map yet.
  // 2 -> 3: the abandoned branch's square-grid map is dropped (its grids stay unused in
  // storage), along with its ocean biomes; the spec has no ocean biomes.
  if (from < 3) {
    const records = { ...rec(o.records) };
    if (from === 2)
      for (const [id, r] of Object.entries(records)) {
        const x = rec(r);
        if (x.kind === 'biome' && rec(x.fields).realm === 'ocean') delete records[id];
      }
    o = { ...o, records, map: null };
  }
  // 3 -> 4: a map gets an empty biome grid (no blob yet, read as all "no biome"), and the
  // starter biomes are added the next time the world opens.
  if (from < 4 && o.map) {
    const m = rec(o.map);
    o = { ...o, map: { ...m, biomeBlob: `${String(m.landBlob)}-biomes`, biomeSlots: [null], biomesSeeded: false } };
  }
  // 4 -> 5: a map gets a base elevation (no blob yet: land is read as low plains) and no placed icons.
  if (from < 5 && o.map) {
    const m = rec(o.map);
    o = { ...o, map: { ...m, elevationBlob: `${String(m.landBlob)}-elevation`, icons: [], hiddenAuto: [] } };
  }
  // 5 -> 6: a map gets no rivers yet.
  if (from < 6 && o.map) o = { ...o, map: { ...rec(o.map), rivers: [] } };
  return o;
}

const ICON_SET = new Set<string>(ICON_KINDS);
const SHAPES = new Set<string>(CLIFF_SHAPES);

function readIcons(v: unknown): PlacedIcon[] {
  if (!Array.isArray(v)) return [];
  const out: PlacedIcon[] = [];
  const ids = new Set<string>();
  for (const item of v.slice(0, 20000)) {
    const r = rec(item);
    if (!isStr(r.id) || ids.has(r.id) || !isStr(r.kind) || !ICON_SET.has(r.kind) || !isNum(r.x) || !isNum(r.y) || !isPos(r.size)) continue;
    ids.add(r.id);
    const icon: PlacedIcon = { id: r.id, kind: r.kind as IconKind, x: r.x, y: r.y, size: r.size };
    if (isNum(r.variant) && r.variant >= 0) icon.variant = Math.floor(r.variant);
    if (isNum(r.angle)) icon.angle = r.angle;
    if (isStr(r.shape) && SHAPES.has(r.shape)) icon.shape = r.shape as CliffShape;
    if (isNum(r.meters)) icon.meters = r.meters;
    out.push(icon);
  }
  return out;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isDate = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const KINDS = new Set<string>(RECORD_KINDS);

function readMap(v: unknown): MapInfo | null {
  const m = rec(v);
  if (!isPos(m.widthKm) || !isPos(m.heightKm) || !isPos(m.width) || !isPos(m.height) || !Number.isInteger(m.cellCount) || !isPos(m.cellCount)) return null;
  if (!isStr(m.graphBlob) || !isStr(m.landBlob) || !Number.isInteger(m.seed)) return null;
  const slots = Array.isArray(m.biomeSlots) ? m.biomeSlots.slice(0, 256).map((s, i) => (i > 0 && isStr(s) ? s : null)) : [];
  if (!slots.length) slots.push(null);
  return {
    widthKm: m.widthKm,
    heightKm: m.heightKm,
    width: m.width,
    height: m.height,
    cellCount: m.cellCount as number,
    seed: (m.seed as number) >>> 0,
    graphBlob: m.graphBlob,
    landBlob: m.landBlob,
    biomeBlob: isStr(m.biomeBlob) ? m.biomeBlob : `${m.landBlob}-biomes`,
    biomeSlots: slots,
    biomesSeeded: m.biomesSeeded !== false,
    elevationBlob: isStr(m.elevationBlob) ? m.elevationBlob : `${m.landBlob}-elevation`,
    icons: readIcons(m.icons),
    hiddenAuto: Array.isArray(m.hiddenAuto) ? (m.hiddenAuto as unknown[]).filter(isStr).slice(0, 200000) : [],
    rivers: readRivers(m.rivers, m.width, m.height),
  };
}

/** Rivers that make sense: an ID, at least two points on the map, a width. Others are left out. */
function readRivers(v: unknown, w: number, h: number): River[] {
  if (!Array.isArray(v)) return [];
  const out: River[] = [];
  const ids = new Set<string>();
  for (const item of v.slice(0, 5000)) {
    const r = rec(item);
    if (!isStr(r.id) || ids.has(r.id) || !isPos(r.width) || !Array.isArray(r.points)) continue;
    const points: [number, number][] = [];
    for (const p of (r.points as unknown[]).slice(0, 20000)) {
      if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) continue;
      points.push([Math.max(0, Math.min(w, p[0])), Math.max(0, Math.min(h, p[1]))]);
    }
    if (points.length < 2) continue;
    ids.add(r.id);
    out.push({ id: r.id, points, width: r.width });
  }
  return out;
}

/**
 * Checks a world (from storage or a file) and returns it in the current format.
 * Damaged parts are dropped rather than refusing the whole world; a world with no ID
 * or a version from a newer app is refused.
 */
export function readWorld(raw: unknown, version: number): Parsed<WorldDoc> {
  if (!Number.isInteger(version) || version < 1) return { ok: false, reason: 'Its format version is missing.' };
  if (version > FORMAT_VERSION) return { ok: false, reason: `It was saved by a newer version of the app (format ${version}). Reload the app to update it, then try again.` };
  const o = upgrade(rec(raw), version);
  if (!isStr(o.id) || !o.id) return { ok: false, reason: 'It has no world ID.' };
  const now = new Date().toISOString();
  const records: Record<string, WorldRecord> = {};
  for (const [key, value] of Object.entries(rec(o.records))) {
    const r = rec(value);
    if (!isStr(r.id) || r.id !== key || !isStr(r.kind) || !KINDS.has(r.kind)) continue;
    const out: WorldRecord = { id: r.id, kind: r.kind as RecordKind, name: isStr(r.name) ? r.name : '', fields: rec(r.fields) as Record<string, FieldValue> };
    if (isStr(r.text) && r.text) out.text = r.text;
    if (Array.isArray(r.images)) out.images = r.images.filter(isStr);
    if (Array.isArray(r.links)) out.links = r.links.filter(isStr);
    records[key] = out;
  }
  return {
    ok: true,
    data: {
      id: o.id,
      name: isStr(o.name) && o.name.trim() ? o.name : 'Untitled world',
      createdAt: isDate(o.createdAt) ? o.createdAt : now,
      updatedAt: isDate(o.updatedAt) ? o.updatedAt : now,
      records,
      map: readMap(o.map),
    },
  };
}

// ---------------------------------------------------------------- export file

interface FileBlob {
  id: string;
  type: string;
  /** Base64. */
  data: string;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fromBase64(data: string, type: string): Promise<Blob> {
  const res = await fetch(`data:${type || 'application/octet-stream'};base64,${data}`);
  return res.blob();
}

/** One file holding the whole world, its images and map data included. */
export async function exportFile(doc: WorldDoc, blobs: WorldBlob[]): Promise<Blob> {
  const files: FileBlob[] = [];
  for (const b of blobs) files.push({ id: b.id, type: b.type, data: await toBase64(b.data) });
  const body = { format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), world: doc, blobs: files };
  return new Blob([JSON.stringify(body)], { type: 'application/json' });
}

export function exportFileName(name: string) {
  // Characters Windows and macOS do not allow in file names become a dash.
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'World';
  return safe + FILE_SUFFIX;
}

/** Reads an exported world file. The world keeps its ID here; the caller gives it a new one if that ID is already in use. */
export async function readExportFile(file: File): Promise<Parsed<{ doc: WorldDoc; blobs: Omit<WorldBlob, 'worldId'>[] }>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { ok: false, reason: 'It is not a world file (it is not valid JSON).' };
  }
  const o = rec(raw);
  if (o.format !== FORMAT) return { ok: false, reason: 'It is not a Worldbuilding Sandbox world file.' };
  const world = readWorld(o.world, Number(o.version));
  if (!world.ok) return world;
  const blobs: Omit<WorldBlob, 'worldId'>[] = [];
  try {
    for (const item of Array.isArray(o.blobs) ? o.blobs : []) {
      const b = rec(item);
      if (!isStr(b.id) || !isStr(b.data)) continue;
      const type = isStr(b.type) ? b.type : '';
      blobs.push({ id: b.id, type, data: await fromBase64(b.data, type) });
    }
  } catch {
    return { ok: false, reason: 'Its images or map data are damaged.' };
  }
  return { ok: true, data: { doc: world.data, blobs } };
}

/** Saves a file to the computer's Downloads (Chrome asks where, if it is set to). */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
