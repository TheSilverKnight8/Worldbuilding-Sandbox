// Small things the app remembers on this computer between visits (not part of any world).
// Browser storage can be unavailable, so every read and write is allowed to fail.

function stored(key: string) {
  return {
    get(): string | null {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(value: string | null) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        // not remembered; nothing else depends on it
      }
    },
  };
}

/** Which look (atlas or painterly) a world was last shown in. */
export const mapStyleFor = (worldId: string) => stored(`worldbuilding-sandbox:map-style:${worldId}`);

// The look (atlas or painterly) is shared by the map and the entry pages, and remembered per world.
type Look = 'atlas' | 'painterly';
const lookListeners = new Set<() => void>();
const lookCache = new Map<string, Look>();
export function lookFor(worldId: string): Look {
  let v = lookCache.get(worldId);
  if (!v) {
    v = mapStyleFor(worldId).get() === 'painterly' ? 'painterly' : 'atlas';
    lookCache.set(worldId, v);
  }
  return v;
}
export function setLook(worldId: string, look: Look) {
  lookCache.set(worldId, look);
  mapStyleFor(worldId).set(look);
  for (const fn of lookListeners) fn();
}
export function onLookChange(fn: () => void) {
  lookListeners.add(fn);
  return () => void lookListeners.delete(fn);
}
