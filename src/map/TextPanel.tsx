import { useEffect, useRef, useState } from 'react';
import { Spline, Trash2, X } from 'lucide-react';
import { Button, IconButton, Input, Select, cx } from '../components/ui';
import { TEXT_KINDS, TEXT_SCALE_MAX, TEXT_SCALE_MIN, TEXT_STYLES } from '../lib/map/text';
import type { MapText, TextKind } from '../lib/world/types';
import type { TextTool } from './MapCanvas';

interface Props {
  tool: TextTool;
  /** The kind of the next text added. */
  kind: TextKind;
  onKind: (k: TextKind) => void;
  selected: MapText | null;
  onChange: (patch: Partial<MapText>, key?: string) => void;
  onStraighten: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}

/** A kind's name, in its own font. */
function KindName({ kind }: { kind: TextKind }) {
  const st = TEXT_STYLES[kind];
  return (
    <span style={{ fontFamily: `"${st.family}"`, fontWeight: st.weight, fontStyle: st.italic ? 'italic' : 'normal', letterSpacing: `${Math.min(st.spacing, 0.2)}em`, textTransform: st.caps ? 'uppercase' : 'none' }} className="text-[0.95rem]">
      {st.label}
    </span>
  );
}

/** A number field that keeps what is typed until it is a valid number. */
function NumberField({ label, unit, value, min, max, onChange }: { label: string; unit: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
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
          aria-label={label}
          className="h-9 pr-10 font-mono text-sm"
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

/** The words of the selected text: kept as typed, saved as one undo step per pause. */
function WordsField({ text, multiline, onChange }: { text: MapText; multiline: boolean; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // A text just added is ready to type into.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [text.id]);
  return (
    <label className="block space-y-1">
      <span className="block text-sm">Text</span>
      <textarea
        ref={ref}
        value={text.text}
        rows={multiline ? 3 : 1}
        aria-label="Text"
        className="w-full resize-y rounded-lg border border-line bg-raised px-3 py-2 text-sm outline-none focus:border-navy"
        onChange={(e) => onChange(multiline ? e.target.value : e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => !multiline && e.key === 'Enter' && e.preventDefault()}
      />
      {multiline && <span className="block text-xs text-muted">Each line of the box is a line on the map.</span>}
    </label>
  );
}

const HELP: Record<TextTool, string> = {
  add: 'Click the map to add text there, or drag along a line (a river, a range) to add text that follows it. Then type its words beside the map.',
  select: 'Click text to select it; drag it to move it.',
};

/** Beside the map in Text mode: the kind of the next text, and the selected text's settings. */
export function TextPanel({ tool, kind, onKind, selected, onChange, onStraighten, onDelete, onDeselect }: Props) {
  return (
    <aside className="scrollbar-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      {selected && (
        <section className="border-b border-line px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-caps text-accent">Selected text</h2>
            <IconButton label="Done (Esc)" className="size-7" onClick={onDeselect}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="space-y-3">
            <WordsField text={selected} multiline={!selected.curve} onChange={(v) => onChange({ text: v }, `words ${selected.id}`)} />
            <label className="block space-y-1">
              <span className="block text-sm">Kind</span>
              <Select value={selected.kind} aria-label="Kind" className="h-9 w-full text-sm" onChange={(e) => onChange({ kind: e.target.value as TextKind })}>
                {TEXT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {TEXT_STYLES[k].label}
                  </option>
                ))}
              </Select>
            </label>
            <NumberField label="Size" unit="%" value={Math.round((selected.scale ?? 1) * 100)} min={TEXT_SCALE_MIN * 100} max={TEXT_SCALE_MAX * 100} onChange={(v) => onChange({ scale: v / 100 }, `size ${selected.id}`)} />
            {selected.curve ? (
              <div className="space-y-2">
                <p className="text-xs text-muted">It follows the line it was drawn along.</p>
                <Button size="sm" variant="secondary" onClick={onStraighten}>
                  <Spline className="size-4" />
                  Make it straight
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                <NumberField label="Turn" unit="°" value={Math.round(((((selected.angle ?? 0) + 180) % 360) + 360) % 360 - 180)} min={-180} max={180} onChange={(v) => onChange({ angle: (v + 360) % 360 }, `turn ${selected.id}`)} />
                <input
                  type="range"
                  className="slider w-full"
                  min={-180}
                  max={180}
                  aria-label="Turn slider"
                  value={Math.round(((((selected.angle ?? 0) + 180) % 360) + 360) % 360 - 180)}
                  style={{ ['--fill' as string]: `${((((((selected.angle ?? 0) + 180) % 360) + 360) % 360) / 360) * 100}%` }}
                  onChange={(e) => onChange({ angle: (Number(e.target.value) + 360) % 360 }, `turn ${selected.id}`)}
                />
              </div>
            )}
            <Button size="sm" variant="danger" onClick={onDelete}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
        </section>
      )}
      <section className="px-4 py-4">
        <h2 className="label-caps mb-2 text-muted">New text</h2>
        <div role="radiogroup" aria-label="Kind of text" className="space-y-1">
          {TEXT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => onKind(k)}
              className={cx('flex w-full items-center rounded-lg border px-3 py-1.5 text-left transition', kind === k ? 'border-navy bg-navy/10' : 'border-transparent hover:bg-raised')}
            >
              <KindName kind={k} />
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{HELP[tool]}</p>
      </section>
    </aside>
  );
}
