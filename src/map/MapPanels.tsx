import { useRef, useState, type ReactNode } from 'react';
import { Eraser, ImagePlus, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { alertDialog, confirmDialog, notify, promptDialog } from '../components/dialogs';
import { Button, IconButton, cx } from '../components/ui';
import { addBiome, deleteBiome, removeBackdrop, setBackdrop, updateBiome } from '../lib/store';
import { biomeFields, biomeList } from '../lib/map/biomes';
import type { MapInfo, Realm, WorldDoc, WorldRecord } from '../lib/world/types';
import type { LayerSettings } from './MapCanvas';

const NEW_COLOR: Record<Realm, string> = { land: '#9fb87a', ocean: '#4d7ea8' };

interface Props {
  world: WorldDoc;
  map: MapInfo;
  layers: LayerSettings;
  onLayers: (l: LayerSettings) => void;
  selectedBiome: string | null;
  onSelectBiome: (id: string | null) => void;
  biomeMode: boolean;
}

export function MapPanels({ world, map, layers, onLayers, selectedBiome, onSelectBiome, biomeMode }: Props) {
  const biomes = biomeList(world, map);
  const land = biomes.filter((b) => biomeFields(b).realm === 'land');
  const ocean = biomes.filter((b) => biomeFields(b).realm === 'ocean');
  const set = (patch: Partial<LayerSettings>) => onLayers({ ...layers, ...patch });

  const add = async (realm: Realm) => {
    const name = await promptDialog({ title: realm === 'land' ? 'New land biome' : 'New ocean biome', label: 'Name', confirm: 'Add biome' });
    if (!name) return;
    const r = addBiome(name, realm, NEW_COLOR[realm]);
    if (!r.ok) return void alertDialog({ title: 'Could not add the biome', body: r.reason });
    onSelectBiome(r.value);
  };

  return (
    <aside className="scrollbar-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      <Section title="Layers">
        {map.backdrop && (
          <LayerRow label="Image" checked={layers.backdrop} onCheck={(v) => set({ backdrop: v })} opacity={layers.backdropOpacity} onOpacity={(v) => set({ backdropOpacity: v })} />
        )}
        <LayerRow label="Land and ocean" checked={layers.map} onCheck={(v) => set({ map: v })} opacity={layers.mapOpacity} onOpacity={(v) => set({ mapOpacity: v })} />
        <div className="ml-6 space-y-1.5">
          <Check label="Biomes" checked={layers.biomes} disabled={!layers.map} onChange={(v) => set({ biomes: v })} />
          <Check label="Relief shading" checked={layers.relief} disabled={!layers.map} onChange={(v) => set({ relief: v })} />
        </div>
      </Section>

      <Section title="Biomes">
        <button
          onClick={() => onSelectBiome(null)}
          className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition', biomeMode && !selectedBiome ? 'bg-navy text-on-accent' : 'hover:bg-raised')}
        >
          <Eraser className="size-4" />
          No biome (erase)
        </button>
        <BiomeGroup title="Land" biomes={land} selected={biomeMode ? selectedBiome : null} onSelect={onSelectBiome} onAdd={() => void add('land')} />
        <BiomeGroup title="Ocean" biomes={ocean} selected={biomeMode ? selectedBiome : null} onSelect={onSelectBiome} onAdd={() => void add('ocean')} />
      </Section>

      <Section title="Image">
        <BackdropControls map={map} />
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4">
      <h2 className="label-caps mb-3 text-muted">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cx('flex items-center gap-2 text-sm', disabled && 'opacity-45')}>
      <input type="checkbox" className="size-4 accent-[var(--navy)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function LayerRow({ label, checked, onCheck, opacity, onOpacity }: { label: string; checked: boolean; onCheck: (v: boolean) => void; opacity: number; onOpacity: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Check label={label} checked={checked} onChange={onCheck} />
      <div className={cx('ml-6 flex items-center gap-2', !checked && 'opacity-45')}>
        <input
          type="range"
          className="slider flex-1"
          min={0}
          max={100}
          value={Math.round(opacity * 100)}
          disabled={!checked}
          aria-label={`${label} opacity`}
          style={{ ['--fill' as string]: `${opacity * 100}%` }}
          onChange={(e) => onOpacity(Number(e.target.value) / 100)}
        />
        <span className="w-9 text-right font-mono text-xs text-muted">{Math.round(opacity * 100)}%</span>
      </div>
    </div>
  );
}

function BiomeGroup({ title, biomes, selected, onSelect, onAdd }: { title: string; biomes: WorldRecord[]; selected: string | null; onSelect: (id: string) => void; onAdd: () => void }) {
  return (
    <div className="pt-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</span>
        <IconButton label={`Add a ${title.toLowerCase()} biome`} className="size-7" onClick={onAdd}>
          <Plus className="size-4" />
        </IconButton>
      </div>
      <ul className="space-y-0.5">
        {biomes.map((b) => (
          <BiomeRow key={b.id} biome={b} selected={selected === b.id} onSelect={() => onSelect(b.id)} />
        ))}
      </ul>
    </div>
  );
}

function BiomeRow({ biome, selected, onSelect }: { biome: WorldRecord; selected: boolean; onSelect: () => void }) {
  const f = biomeFields(biome);
  const rename = async () => {
    const name = await promptDialog({ title: 'Rename biome', label: 'Name', value: biome.name });
    if (name) updateBiome(biome.id, { name });
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${biome.name}”?`,
      body: 'Cells painted with it go back to no biome. This cannot be undone.',
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
      <button className="min-w-0 flex-1 truncate px-1.5 py-1.5 text-left text-sm" onClick={onSelect} title={biome.text || biome.name}>
        {biome.name}
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

function BackdropControls({ map }: { map: MapInfo }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const r = await setBackdrop(file);
    setBusy(false);
    if (!r.ok) return void alertDialog({ title: 'Could not use this image', body: r.reason });
    if (r.value.stretched) notify('The image has a different shape from the map, so it is stretched to fit.', 'warn');
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Remove the image?',
      body: 'The image is removed from this world for good. Everything you painted stays, drawn by the app.',
      confirm: 'Remove image',
      danger: true,
    });
    if (!ok) return;
    await removeBackdrop();
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {map.backdrop ? (
        <>
          <p className="truncate text-sm" title={map.backdrop.fileName}>
            {map.backdrop.fileName}
          </p>
          <p className="text-xs text-muted">
            {map.backdrop.width} × {map.backdrop.height} px, under a map grid of {map.width} × {map.height} cells.
          </p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" loading={busy} onClick={() => input.current?.click()}>
              {!busy && <RefreshCw className="size-4" />}
              Replace
            </Button>
            <Button size="sm" variant="danger" onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">No image. The map is drawn by the app ({map.width} × {map.height} cells).</p>
          <Button size="sm" loading={busy} onClick={() => input.current?.click()}>
            {!busy && <ImagePlus className="size-4" />}
            Add an image to trace
          </Button>
        </>
      )}
    </>
  );
}
