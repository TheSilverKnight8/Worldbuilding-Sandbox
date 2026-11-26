import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Button, IconButton, Input, cx } from '../components/ui';
import { ROTATABLE, sprite } from '../lib/map/icons';
import { KINDS } from '../lib/map/terrain';
import { ICON_KINDS, TERRAIN_KINDS, type IconKind, type PlacedIcon } from '../lib/world/types';

/** Settings for an icon: size in km, meters (height or depth), direction in degrees. */
export interface IconSettings {
  sizeKm: number;
  meters?: number;
  angle?: number;
}

interface Props {
  kind: IconKind;
  onKind: (k: IconKind) => void;
  /** Settings for the next icon placed. */
  settings: IconSettings;
  onSettings: (s: IconSettings) => void;
  /** The placed icon being edited, if any. */
  selected: PlacedIcon | null;
  selectedSettings: IconSettings | null;
  onSelectedSettings: (s: IconSettings) => void;
  onDelete: () => void;
  onDeselect: () => void;
}

const PLANTS = ICON_KINDS.filter((k) => !TERRAIN_KINDS.includes(k as never));

/** A small picture of an icon, drawn with the same code as the map's. */
function Preview({ kind }: { kind: IconKind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const size = 30;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const px = ROTATABLE.has(kind) ? 26 : kind === 'plateau' || kind === 'dunes' ? 26 : 22;
    const sp = sprite(kind, 0, Math.round(px * dpr), 'atlas');
    const w = sp.canvas.width / dpr;
    const h = sp.canvas.height / dpr;
    const ax = sp.ax / dpr;
    const ay = sp.ay / dpr;
    const gx = size / 2;
    const gy = ROTATABLE.has(kind) ? size / 2 : size - 3;
    ctx.drawImage(sp.canvas, gx - ax, gy - ay, w, h);
  }, [kind]);
  return <canvas ref={ref} className="size-[30px]" aria-hidden />;
}

function KindButton({ kind, active, onClick }: { kind: IconKind; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Place ${KINDS[kind].label.toLowerCase()}`}
      title={KINDS[kind].label}
      className={cx('flex flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[0.6875rem] leading-tight transition', active ? 'border-navy bg-navy/10' : 'border-transparent hover:bg-raised')}
    >
      <Preview kind={kind} />
      <span className="w-full truncate text-center">{KINDS[kind].label}</span>
    </button>
  );
}

/** A number field that keeps what is typed until it is a valid number. */
function NumberField({ label, unit, value, min, max, step, onChange }: { label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (t: string) => {
    const n = Number(t);
    if (t.trim() === '' || !Number.isFinite(n)) return setText(String(value));
    const v = Math.max(min, Math.min(max, n));
    onChange(v);
    setText(String(v));
  };
  return (
    <label className="block space-y-1">
      <span className="block text-sm">{label}</span>
      <span className="relative block">
        <Input
          type="number"
          value={text}
          min={min}
          max={max}
          step={step}
          className="h-9 pr-10 font-mono text-sm"
          aria-label={label}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{unit}</span>
      </span>
    </label>
  );
}

function Settings({ kind, settings, onChange }: { kind: IconKind; settings: IconSettings; onChange: (s: IconSettings) => void }) {
  const info = KINDS[kind];
  return (
    <div className="space-y-3">
      <NumberField label="Size" unit="km" value={Math.round(settings.sizeKm * 10) / 10} min={0.1} max={5000} step={1} onChange={(v) => onChange({ ...settings, sizeKm: v })} />
      {info.meters && (
        <NumberField label={`${info.meters.label}`} unit="m" value={settings.meters ?? info.meters.value} min={0} max={9000} step={50} onChange={(v) => onChange({ ...settings, meters: v })} />
      )}
      {info.rotatable && (
        <label className="block space-y-1">
          <span className="block text-sm">Direction</span>
          <span className="flex items-center gap-2">
            <input
              type="range"
              className="slider flex-1"
              min={0}
              max={180}
              value={Math.round(settings.angle ?? 0)}
              aria-label="Direction"
              style={{ ['--fill' as string]: `${((settings.angle ?? 0) / 180) * 100}%` }}
              onChange={(e) => onChange({ ...settings, angle: Number(e.target.value) })}
            />
            <span className="w-10 text-right font-mono text-xs">{Math.round(settings.angle ?? 0)}°</span>
          </span>
        </label>
      )}
    </div>
  );
}

/** Beside the map in Icons mode: pick an icon to place, set it up, and edit the one selected. */
export function IconsPanel({ kind, onKind, settings, onSettings, selected, selectedSettings, onSelectedSettings, onDelete, onDeselect }: Props) {
  return (
    <aside className="scrollbar-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      {selected && selectedSettings ? (
        <section className="border-b border-line px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-caps text-accent">Selected: {KINDS[selected.kind].label}</h2>
            <IconButton label="Done (Esc)" className="size-7" onClick={onDeselect}>
              <X className="size-4" />
            </IconButton>
          </div>
          <Settings kind={selected.kind} settings={selectedSettings} onChange={onSelectedSettings} />
          <p className="mt-3 text-xs text-muted">Drag it on the map to move it.</p>
          <Button size="sm" variant="danger" className="mt-3" onClick={onDelete}>
            <Trash2 className="size-4" />
            Delete
          </Button>
        </section>
      ) : null}
      <section className="border-b border-line px-4 py-4">
        <h2 className="label-caps mb-2 text-muted">Terrain</h2>
        <div className="grid grid-cols-4 gap-1">
          {TERRAIN_KINDS.map((k) => (
            <KindButton key={k} kind={k} active={kind === k} onClick={() => onKind(k)} />
          ))}
        </div>
        <h2 className="label-caps mb-2 mt-4 text-muted">Plants and ground</h2>
        <div className="grid grid-cols-4 gap-1">
          {PLANTS.map((k) => (
            <KindButton key={k} kind={k} active={kind === k} onClick={() => onKind(k)} />
          ))}
        </div>
      </section>
      <section className="px-4 py-4">
        <h2 className="label-caps mb-3 text-muted">New {KINDS[kind].label.toLowerCase()}</h2>
        <Settings kind={kind} settings={settings} onChange={onSettings} />
        <p className="mt-3 text-xs text-muted">
          Click the map to place one. Click an icon to select it; drag to move it; <kbd className="font-mono">Delete</kbd> removes it.
          {KINDS[kind].group === 'terrain' && ' Terrain icons shape the ground around them, and stay where you put them.'}
        </p>
      </section>
    </aside>
  );
}
