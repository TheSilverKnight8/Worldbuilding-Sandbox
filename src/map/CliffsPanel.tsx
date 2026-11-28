import { useEffect, useState } from 'react';
import { ArrowLeftRight, Trash2, X } from 'lucide-react';
import { Button, IconButton, Input } from '../components/ui';
import type { Cliff } from '../lib/world/types';
import type { CliffTool } from './MapCanvas';

interface Props {
  tool: CliffTool;
  /** The drop of the next cliff, in meters. */
  newMeters: number;
  onNewMeters: (v: number) => void;
  selected: Cliff | null;
  /** The selected cliff's length, in km. */
  selectedLengthKm: number;
  onMeters: (m: number) => void;
  onFlip: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}

/** A meters field that keeps what is typed until it is a valid number. */
function MetersField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const ok = (t: string) => t.trim() !== '' && Number.isFinite(Number(t)) && Number(t) >= 10 && Number(t) <= 9000;
  return (
    <label className="block space-y-1">
      <span className="block text-sm">{label}</span>
      <span className="relative block">
        <Input
          type="number"
          value={text}
          min={10}
          max={9000}
          step={50}
          aria-label={label}
          className="h-9 pr-10 font-mono text-sm"
          onChange={(e) => {
            setText(e.target.value);
            if (ok(e.target.value)) onChange(Number(e.target.value));
          }}
          onBlur={(e) => !ok(e.target.value) && setText(String(value))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">m</span>
      </span>
    </label>
  );
}

const HELP: Record<CliffTool, string> = {
  draw: 'Drag along where the cliff runs: it follows the polygon borders nearest your stroke. The drop is on the right of the way you drag (the short marks while you draw); a stroke that ends where it began makes a ring.',
  select: 'Click a cliff (its rim or its face) to select it.',
};

/** Beside the map in Cliffs mode: the next cliff's drop, and the selected cliff's settings. */
export function CliffsPanel({ tool, newMeters, onNewMeters, selected, selectedLengthKm, onMeters, onFlip, onDelete, onDeselect }: Props) {
  return (
    <aside className="scrollbar-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      {selected && (
        <section className="border-b border-line px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-caps text-accent">Selected cliff</h2>
            <IconButton label="Done (Esc)" className="size-7" onClick={onDeselect}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="space-y-3">
            <MetersField label="Drop" value={Math.round(selected.meters)} onChange={onMeters} />
            <p className="text-xs text-muted">{Math.round(selectedLengthKm).toLocaleString()} km long. The ground on its high side is raised by the drop, and the face is drawn taller for a bigger drop.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={onFlip}>
                <ArrowLeftRight className="size-4" />
                Drop the other way
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
        <h2 className="label-caps mb-3 text-muted">New cliff</h2>
        <MetersField label="Drop" value={newMeters} onChange={onNewMeters} />
        <p className="mt-3 text-xs text-muted">{HELP[tool]}</p>
        <p className="mt-2 text-xs text-muted">Where the drop faces you, the rock face shows below the rim; where it faces away, only the rim. Where a river goes over a cliff, a waterfall appears; at the shore it falls into the water.</p>
      </section>
    </aside>
  );
}
