import { useEffect, useState } from 'react';
import { ArrowLeftRight, Trash2, X } from 'lucide-react';
import { Button, IconButton, Input } from '../components/ui';
import type { River } from '../lib/world/types';
import type { RiverTool } from './MapCanvas';

interface Props {
  tool: RiverTool;
  /** Width at the mouth for the next river, in km. */
  newWidthKm: number;
  onNewWidthKm: (v: number) => void;
  selected: River | null;
  /** The selected river's length, in km. */
  selectedLengthKm: number;
  kmPerUnit: number;
  onWidth: (km: number) => void;
  onFlip: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}

/** A km field that keeps what is typed until it is a valid number. */
function KmField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const ok = (t: string) => t.trim() !== '' && Number.isFinite(Number(t)) && Number(t) > 0 && Number(t) <= 1000;
  return (
    <label className="block space-y-1">
      <span className="block text-sm">{label}</span>
      <span className="relative block">
        <Input
          type="number"
          value={text}
          min={0.1}
          max={1000}
          step={0.5}
          aria-label={label}
          className="h-9 pr-10 font-mono text-sm"
          onChange={(e) => {
            setText(e.target.value);
            if (ok(e.target.value)) onChange(Number(e.target.value));
          }}
          onBlur={(e) => !ok(e.target.value) && setText(String(value))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">km</span>
      </span>
    </label>
  );
}

const HELP: Record<RiverTool, string> = {
  draw: 'Drag from where the river starts to where it reaches the sea. It follows the polygon borders nearest your stroke, widening toward its mouth. Ending on another river joins it.',
  route: 'Click where a river starts: the app runs it downhill over the heightmap to the sea, a lake, the map’s edge, or another river.',
  select: 'Click a river to select it.',
};

/** Beside the map in Rivers mode: the new river's width, and the selected river's settings. */
export function RiversPanel({ tool, newWidthKm, onNewWidthKm, selected, selectedLengthKm, kmPerUnit, onWidth, onFlip, onDelete, onDeselect }: Props) {
  const round = (v: number) => Math.round(v * 10) / 10;
  return (
    <aside className="scrollbar-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      {selected && (
        <section className="border-b border-line px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-caps text-accent">Selected river</h2>
            <IconButton label="Done (Esc)" className="size-7" onClick={onDeselect}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="space-y-3">
            <KmField label="Width at the mouth" value={round(selected.width * kmPerUnit)} onChange={onWidth} />
            <p className="text-xs text-muted">
              {Math.round(selectedLengthKm).toLocaleString()} km long. Rivers that join it make it wider below where they join.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={onFlip}>
                <ArrowLeftRight className="size-4" />
                Flow the other way
              </Button>
              <Button size="sm" variant="danger" onClick={onDelete}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </div>
        </section>
      )}
      <section className="px-4 py-4">
        <h2 className="label-caps mb-3 text-muted">New river</h2>
        <KmField label="Width at the mouth" value={round(newWidthKm)} onChange={onNewWidthKm} />
        <p className="mt-3 text-xs text-muted">{HELP[tool]}</p>
        <p className="mt-2 text-xs text-muted">Where a river goes over a cliff, a waterfall appears (at the shore it falls into the water). Waterfalls can also be placed one by one in Icons mode. Lakes are water painted inside land.</p>
      </section>
    </aside>
  );
}
