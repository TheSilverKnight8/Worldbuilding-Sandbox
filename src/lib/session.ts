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
