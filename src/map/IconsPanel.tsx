import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Button, IconButton, Input, Select, cx } from '../components/ui';
import { aspectOf, iconBox, iconSprite, placementLook } from '../lib/map/icons';
import { KINDS } from '../lib/map/terrain';
import { CLIFF_SHAPES, ICON_KINDS, TERRAIN_KINDS, type CliffShape, type IconKind, type PlacedIcon } from '../lib/world/types';

/** Settings for an icon: width in km, meters (height or drop), a cliff's direction (compass degrees its drop faces) and shape. */
export interface IconSettings {
  sizeKm: number;
  meters?: number;
  angle?: number;
  shape?: CliffShape;
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
const SHAPE_LABELS: Record<CliffShape, string> = { even: 'Even', 'taper-left': 'Fades out to the left', 'taper-right': 'Fades out to the right', broken: 'Broken in two' };
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

/** A small picture of an icon, drawn with the same code as the map's. */
function Preview({ kind, variant = 0, angle, shape, size = 30 }: { kind: IconKind; variant?: number; angle?: number; shape?: CliffShape; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const aspect = aspectOf(kind);
    // As wide as fits, keeping the drawing's shape; centered in the box.
    const w = Math.min(size - 4, (size - 4) / aspect);
    const h = w * aspect;
    const { turn, look } = placementLook({ set: kind, angle, shape });
    const sp = iconSprite(kind, variant, 'atlas', Math.round(w * dpr), look, true);
    if (!sp) return;
    const k = w / sp.w;
    const b = iconBox({ set: kind, size: w }, look.away);
    ctx.save();
    // The ground point, so that the drawing's box sits in the middle (a cliff turns around it).
    ctx.translate(size / 2, kind === 'cliff' ? size / 2 : (size - h) / 2 - b.top);
    if (turn) ctx.rotate((turn * Math.PI) / 180);
    ctx.drawImage(sp.canvas, -sp.ax * k, -sp.ay * k, sp.canvas.width * k, sp.canvas.height * k);
    ctx.restore();
  }, [kind, variant, angle, shape, size]);
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

function Settings({ kind, settings, onChange }: { kind: IconKind; settings: IconSettings; onChange: (s: IconSettings) => void }) {
  const info = KINDS[kind];
  const angle = Math.round(settings.angle ?? 180) % 360;
  return (
    <div className="space-y-3">
      <NumberField label="Width" unit="km" value={Math.round(settings.sizeKm * 10) / 10} min={0.1} max={5000} step={1} onChange={(v) => onChange({ ...settings, sizeKm: v })} />
      {info.meters && <NumberField label={info.meters.label} unit="m" value={settings.meters ?? info.meters.value} min={0} max={9000} step={50} onChange={(v) => onChange({ ...settings, meters: v })} />}
      {info.rotatable && (
        <>
          <label className="block space-y-1">
            <span className="block text-sm">Drop faces</span>
            <span className="flex items-center gap-2">
              <input
                type="range"
                className="slider flex-1"
                min={0}
                max={359}
                value={angle}
                aria-label="Drop faces"
                style={{ ['--fill' as string]: `${(angle / 359) * 100}%` }}
                onChange={(e) => onChange({ ...settings, angle: Number(e.target.value) })}
              />
              <span className="w-24 text-right font-mono text-xs">
                {angle}° {COMPASS[Math.round(angle / 45) % 8]}
              </span>
            </span>
          </label>
          <label className="block space-y-1">
            <span className="block text-sm">Shape</span>
            <Select value={settings.shape ?? 'even'} aria-label="Shape" className="h-9 w-full text-sm" onChange={(e) => onChange({ ...settings, shape: e.target.value as CliffShape })}>
              {CLIFF_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {SHAPE_LABELS[s]}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Preview kind="cliff" angle={angle} shape={settings.shape} size={56} />
            <span>Left and right are as seen with the drop facing you. A drop facing away shows only the rim.</span>
          </div>
        </>
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
          With Place, click the map to place one. With Select, click any icon, the app&apos;s own hills, mountains and plants included, to move, resize or delete it; it then stays as you leave it.
          {KINDS[kind].group === 'terrain' && ' Terrain icons shape the ground around them, and stay where you put them.'}
        </p>
      </section>
    </aside>
  );
}
