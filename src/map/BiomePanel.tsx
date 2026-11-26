import { Eraser, Pencil, Plus, Trash2 } from 'lucide-react';
import { alertDialog, confirmDialog, promptDialog } from '../components/dialogs';
import { IconButton, Select, cx } from '../components/ui';
import { addBiome, deleteBiome, updateBiome } from '../lib/store';
import { ICON_SETS, biomeFields, biomeList } from '../lib/map/biomes';
import type { IconSet, MapInfo, WorldDoc, WorldRecord } from '../lib/world/types';

const NEW_COLOR = '#9fb87a';

interface Props {
  world: WorldDoc;
  map: MapInfo;
  /** The biome being painted with (null = no biome, the eraser). */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Whether the biome brush is in use (highlights the selection). */
  active: boolean;
}

/** The biome list beside the map: pick one to paint with, recolor, rename, change its icons, add, delete. */
export function BiomePanel({ world, map, selected, onSelect, active }: Props) {
  const biomes = biomeList(world, map);
  const current = selected ? world.records[selected] : undefined;

  const add = async () => {
    const name = await promptDialog({ title: 'New biome', label: 'Name', confirm: 'Add biome' });
    if (!name) return;
    const r = addBiome(name, NEW_COLOR, 'none');
    if (!r.ok) return void alertDialog({ title: 'Could not add the biome', body: r.reason });
    onSelect(r.value);
  };

  return (
    <aside className="scrollbar-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      <section className="border-b border-line px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="label-caps text-muted">Biomes</h2>
          <IconButton label="Add a biome" className="size-7" onClick={() => void add()}>
            <Plus className="size-4" />
          </IconButton>
        </div>
        <button
          onClick={() => onSelect(null)}
          className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition', active && !selected ? 'bg-navy text-on-accent' : 'hover:bg-raised')}
        >
          <Eraser className="size-4" />
          No biome (erase)
        </button>
        <ul className="mt-1 space-y-0.5">
          {biomes.map((b) => (
            <BiomeRow key={b.id} biome={b} selected={active && selected === b.id} onSelect={() => onSelect(b.id)} />
          ))}
        </ul>
        {biomes.length === 0 && <p className="mt-2 text-sm text-muted">No biomes. Add one with +.</p>}
      </section>
      {current && current.kind === 'biome' && (
        <section className="px-4 py-4">
          <h2 className="label-caps mb-3 text-muted">{current.name}</h2>
          <label className="block space-y-1.5">
            <span className="block text-sm">Icons on the map</span>
            <Select
              value={biomeFields(current).icons}
              className="h-9 text-sm"
              aria-label={`${current.name} icons`}
              onChange={(e) => updateBiome(current.id, { icons: e.target.value as IconSet })}
            >
              {ICON_SETS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <p className="mt-2 text-xs text-muted">The atlas shows biomes only through their icons; the painterly map shows their color as well.</p>
        </section>
      )}
    </aside>
  );
}

function BiomeRow({ biome, selected, onSelect }: { biome: WorldRecord; selected: boolean; onSelect: () => void }) {
  const f = biomeFields(biome);
  const icons = ICON_SETS.find((s) => s.value === f.icons)?.label ?? '';
  const rename = async () => {
    const name = await promptDialog({ title: 'Rename biome', label: 'Name', value: biome.name });
    if (name) updateBiome(biome.id, { name });
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${biome.name}”?`,
      body: 'Land painted with it goes back to no biome. This cannot be undone.',
      confirm: 'Delete biome',
      danger: true,
    });
    if (ok) deleteBiome(biome.id);
  };
  return (
    <li className={cx('group flex items-center gap-1 rounded-lg pr-1 transition', selected ? 'bg-navy/10 ring-1 ring-navy/40' : 'hover:bg-raised')}>
      <label className="relative ml-1.5 size-5 shrink-0 cursor-pointer rounded border border-navy/25" style={{ background: f.color }} title="Change color">
        <input type="color" className="absolute inset-0 size-full cursor-pointer opacity-0" value={f.color} onChange={(e) => updateBiome(biome.id, { color: e.target.value })} aria-label={`${biome.name} color`} />
      </label>
      <button className="min-w-0 flex-1 px-1.5 py-1 text-left" onClick={onSelect} title={`Paint ${biome.name}`} aria-label={`Paint ${biome.name}`}>
        <span className="block truncate text-sm">{biome.name}</span>
        <span className="block truncate text-[0.6875rem] text-muted">{icons}</span>
      </button>
      <IconButton label={`Rename ${biome.name}`} className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void rename()}>
        <Pencil className="size-3.5" />
      </IconButton>
      <IconButton label={`Delete ${biome.name}`} className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void remove()}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </li>
  );
}
