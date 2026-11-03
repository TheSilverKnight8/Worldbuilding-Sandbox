// The map's grids in memory, and how they are stored as blobs.

/** Cells on the long side of a new map (agreed with Caleb in Stage 2). */
export const GRID_LONG_SIDE = 1024;

/** Elevation of every cell on a new map: open ocean. */
export const NEW_MAP_ELEVATION = -1000;
/** The land brush lifts ocean cells to at least this height, and leaves higher land alone. */
export const LAND_MIN = 10;
/** The ocean brush sinks land cells to at least this depth, and leaves deeper ocean alone. */
export const OCEAN_MAX = -10;
/** The range an Int16 can hold, in meters. Deeper than the deepest trench, higher than the highest mountain. */
export const ELEVATION_MIN = -11000;
export const ELEVATION_MAX = 9000;

export interface MapLayers {
  width: number;
  height: number;
  /** Meters above sea level per cell. Above 0 is land. */
  elevation: Int16Array;
  /** Index into MapInfo.biomeSlots per cell. 0 = no biome. */
  biome: Uint8Array;
}

export const isLand = (elevation: number) => elevation > 0;

/** A rectangle of cells: x0 and y0 included, x1 and y1 not. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function newLayers(width: number, height: number): MapLayers {
  return { width, height, elevation: new Int16Array(width * height).fill(NEW_MAP_ELEVATION), biome: new Uint8Array(width * height) };
}

/** Grid size for a map of the given shape: GRID_LONG_SIDE cells on the long side. */
export function gridSizeFor(width: number, height: number) {
  if (width >= height) return { width: GRID_LONG_SIDE, height: Math.max(1, Math.round((GRID_LONG_SIDE * height) / width)) };
  return { width: Math.max(1, Math.round((GRID_LONG_SIDE * width) / height)), height: GRID_LONG_SIDE };
}

export const clampElevation = (v: number) => Math.max(ELEVATION_MIN, Math.min(ELEVATION_MAX, Math.round(v)));

// Blobs hold the raw bytes, little-endian (what every computer running Chrome uses).

export function elevationToBlob(a: Int16Array) {
  return new Blob([a.slice().buffer], { type: 'application/octet-stream' });
}

export function biomeToBlob(a: Uint8Array) {
  return new Blob([a.slice().buffer], { type: 'application/octet-stream' });
}

/** Reads stored grids back. A grid of the wrong size (damaged) is replaced by a fresh one rather than misdrawn. */
export async function layersFromBlobs(width: number, height: number, elevation: Blob | undefined, biome: Blob | undefined): Promise<{ layers: MapLayers; repaired: boolean }> {
  const fresh = newLayers(width, height);
  let repaired = false;
  if (elevation && elevation.size === width * height * 2) fresh.elevation = new Int16Array(await elevation.arrayBuffer());
  else repaired = true;
  if (biome && biome.size === width * height) fresh.biome = new Uint8Array(await biome.arrayBuffer());
  else repaired = true;
  return { layers: fresh, repaired };
}
