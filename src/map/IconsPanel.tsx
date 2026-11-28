import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Button, IconButton, Input, cx } from '../components/ui';
import { frameOf, iconSprite, placementLook } from '../lib/map/icons';
import { KINDS, SIZED_BY_POLYGON, dirOf } from '../lib/map/terrain';
import { ICON_KINDS, SETTLEMENT_KINDS, TERRAIN_KINDS, type IconKind, type PlacedIcon } from '../lib/world/types';

/** Settings for an icon: width in km, meters (a height), a waterfall's direction (compass degrees, one of 8), and a settlement's roof color. */
export interface IconSettings {
  sizeKm: number;
  meters?: number;
  angle?: number;
  color?: string;
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

const PLANTS = ICON_KINDS.filter((k) => KINDS[k].group === 'plants');
const WATER = ICON_KINDS.filter((k) => KINDS[k].group === 'water');
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const COMPASS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** The 8 directions laid out as on a compass (null: the middle). */
const COMPASS_GRID = [7, 0, 1, 6, null, 2, 5, 4, 3] as const;

/** A small picture of an icon, drawn with the same code as the map's. */
function Preview({ kind, variant = 0, angle, size = 30 }: { kind: IconKind; variant?: number; angle?: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const look = placementLook({ set: kind, angle });
    const f = frameOf(kind, look);
    // As wide as fits, keeping the drawing's shape; its box centered.
    const w = (size - 4) / Math.max(f.w, f.h);
    const sp = iconSprite(kind, variant, 'atlas', Math.round(w * dpr), look, true);
    if (!sp) return;
    const k = w / sp.w;
    const x = size / 2 - w * (f.w / 2 - f.ax);
    const y = size / 2 - w * (f.h / 2 - f.ay);
    ctx.drawImage(sp.canvas, x - sp.ax * k, y - sp.ay * k, sp.canvas.width * k, sp.canvas.height * k);
  }, [kind, variant, angle, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />;
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

function Settings({ kind, settings, onChange, sizedByPolygon = false }: { kind: IconKind; settings: IconSettings; onChange: (s: IconSettings) => void; sizedByPolygon?: boolean }) {
  const info = KINDS[kind];
  const dir = dirOf({ angle: settings.angle });
  return (
    <div className="space-y-3">
      <NumberField label="Width" unit="km" value={Math.round(settings.sizeKm * 10) / 10} min={0.1} max={5000} step={1} onChange={(v) => onChange({ ...settings, sizeKm: v })} />
      {sizedByPolygon && <p className="-mt-1.5 text-xs text-muted">Placed ones are sized by their polygon, around this width.</p>}
      {info.group === 'settlements' && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">Roof color</span>
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted">on the painterly map</span>
            <input
              type="color"
              aria-label="Roof color"
              value={settings.color ?? '#a8553c'}
              onChange={(e) => onChange({ ...settings, color: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded border border-line bg-raised p-0.5"
            />
          </span>
        </label>
      )}
      {info.meters && <NumberField label={info.meters.label} unit="m" value={settings.meters ?? info.meters.value} min={0} max={9000} step={50} onChange={(v) => onChange({ ...settings, meters: v })} />}
      {info.directional && (
        <div className="space-y-1">
          <span className="block text-sm">Falls toward</span>
          <div className="flex items-center gap-3">
            <div role="radiogroup" aria-label="Falls toward" className="grid grid-cols-3 gap-1">
              {COMPASS_GRID.map((d, i) =>
                d === null ? (
                  <span key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={dir === d}
                    aria-label={COMPASS[d]}
                    title={COMPASS[d]}
                    onClick={() => onChange({ ...settings, angle: d * 45 })}
                    className={cx('h-7 w-9 rounded-md border font-mono text-[0.6875rem] transition', dir === d ? 'border-navy bg-navy text-on-accent' : 'border-line bg-raised hover:border-navy/50')}
                  >
                    {COMPASS_SHORT[d]}
                  </button>
                ),
              )}
            </div>
            <Preview kind={kind} angle={dir * 45} size={64} />
          </div>
        </div>
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
        <h2 className="label-caps mb-2 mt-4 text-muted">Settlements</h2>
        <div className="grid grid-cols-4 gap-1">
          {SETTLEMENT_KINDS.map((k) => (
            <KindButton key={k} kind={k} active={kind === k} onClick={() => onKind(k)} />
          ))}
        </div>
        <h2 className="label-caps mb-2 mt-4 text-muted">Plants and ground</h2>
        <div className="grid grid-cols-4 gap-1">
          {PLANTS.map((k) => (
            <KindButton key={k} kind={k} active={kind === k} onClick={() => onKind(k)} />
          ))}
        </div>
        <h2 className="label-caps mb-2 mt-4 text-muted">Water</h2>
        <div className="grid grid-cols-4 gap-1">
          {WATER.map((k) => (
            <KindButton key={k} kind={k} active={kind === k} onClick={() => onKind(k)} />
          ))}
        </div>
      </section>
      <section className="px-4 py-4">
        <h2 className="label-caps mb-3 text-muted">New {KINDS[kind].label.toLowerCase()}</h2>
        <Settings kind={kind} settings={settings} onChange={onSettings} sizedByPolygon={SIZED_BY_POLYGON.has(kind)} />
        <p className="mt-3 text-xs text-muted">
          With Place, click a polygon to place one in its middle, one per polygon: clicking a polygon that already has one gives it another drawing, or swaps it for the kind chosen. A polygon a neighbor&apos;s icon only reaches over can take its own; the one in front is drawn on top. With Select, click any icon, a biome&apos;s plants and the waterfalls on rivers included, to move, resize or delete it; it then stays as you leave it.
          {KINDS[kind].group === 'terrain' && ' Terrain icons shape the ground around them, and stay where you put them.'}
        </p>
      </section>
    </aside>
  );
}
