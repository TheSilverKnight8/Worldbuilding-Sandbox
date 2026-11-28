import type { EntryKind } from '../world/entries';
import type { MapInfo, WorldDoc } from '../world/types';
import { cellAt, type Graph } from './graph';
import { KINDS, computeHeights } from './terrain';
import { TEXT_STYLES } from './text';

// Nodes (Stage 8): an icon or a piece of text on the map linked to an entry (Caleb: a node is
// attached to an icon or text, never on its own; placing it on one attaches it, so it moves
// and is deleted with it). The link is the entry's ID, stored on the icon or text.

/** The kinds of entry a node can link to (SPEC.md: settlements, landmarks, features, info nodes, groups). */
export const NODE_KINDS: readonly EntryKind[] = ['settlement', 'landmark', 'feature', 'info', 'group'];

/** Entries whose place on the map gives them a biome and an elevation (SPEC.md: place entries). */
export const PLACE_KINDS: readonly EntryKind[] = ['settlement', 'landmark', 'feature'];

/** An item on the map that can be a node. */
export interface NodeTarget {
  kind: 'icon' | 'text';
  id: string;
}

/** A node on the map: where it is, and what it is attached to (in words). */
export interface NodeSpot extends NodeTarget {
  x: number;
  y: number;
  label: string;
}

/** Every node of an entry on the map. */
export function nodesOf(map: MapInfo, entryId: string): NodeSpot[] {
  const out: NodeSpot[] = [];
  for (const i of map.icons) if (i.entry === entryId) out.push({ kind: 'icon', id: i.id, x: i.x, y: i.y, label: `${KINDS[i.kind].label} icon` });
  for (const t of map.texts) if (t.entry === entryId) out.push({ kind: 'text', id: t.id, x: t.x, y: t.y, label: `${TEXT_STYLES[t.kind].label} text “${t.text.replace(/\n/g, ' ')}”` });
  return out;
}

/** The entry a new node on this item makes by default, by what the item is. */
export function defaultNodeKind(map: MapInfo, target: NodeTarget): EntryKind {
  if (target.kind === 'icon') {
    const i = map.icons.find((q) => q.id === target.id);
    if (!i) return 'landmark';
    const group = KINDS[i.kind].group;
    return group === 'settlements' ? 'settlement' : group === 'terrain' || group === 'water' ? 'feature' : 'landmark';
  }
  const t = map.texts.find((q) => q.id === target.id);
  if (!t) return 'info';
  return t.kind === 'city' ? 'settlement' : t.kind === 'range' ? 'group' : t.kind === 'mountain' || t.kind === 'lake' || t.kind === 'river' ? 'feature' : 'info';
}

/** A name for a new entry made from an item: its words, or the icon's kind. */
export function defaultNodeName(map: MapInfo, target: NodeTarget): string {
  if (target.kind === 'text') return map.texts.find((q) => q.id === target.id)?.text.replace(/\n/g, ' ').trim() || 'New entry';
  const i = map.icons.find((q) => q.id === target.id);
  return i ? `New ${KINDS[i.kind].label.toLowerCase()}` : 'New entry';
}

interface MapData {
  graph: Graph;
  land: Uint8Array;
  biome: Uint8Array;
  elevation: Int16Array;
}

let heightsCache: { map: MapInfo; data: MapData; version: number; heights: Int16Array } | null = null;

/** The final elevation of every cell (as the map shows it), worked out once per version of the map. `version` changes when the map data changes in place (getMapVersion in the store). */
function heightsOf(map: MapInfo, data: MapData, version: number) {
  const hit = heightsCache;
  if (hit && hit.map === map && hit.data === data && hit.version === version) return hit.heights;
  const heights = computeHeights(data.graph, data.land, data.elevation, map.icons, map.cliffs);
  heightsCache = { map, data, version, heights };
  return heights;
}

/** What the map says at a spot: on land or not, its elevation, and its biome (an entry ID, or null). */
export function spotFacts(doc: WorldDoc, data: MapData, version: number, x: number, y: number): { land: boolean; elevation: number; biome: string | null } | null {
  const map = doc.map;
  if (!map) return null;
  const c = cellAt(data.graph, x, y);
  if (c < 0) return null;
  const land = data.land[c] === 1;
  const heights = heightsOf(map, data, version);
  const slot = data.biome[c];
  return { land, elevation: land ? heights[c] : 0, biome: land && slot ? (map.biomeSlots[slot] ?? null) : null };
}

/** An entry's elevation, from its first node on the map (null if it has none). */
export function entryElevation(doc: WorldDoc, data: MapData | null, version: number, entryId: string): number | null {
  if (!doc.map || !data) return null;
  const spot = nodesOf(doc.map, entryId)[0];
  if (!spot) return null;
  return spotFacts(doc, data, version, spot.x, spot.y)?.elevation ?? null;
}
