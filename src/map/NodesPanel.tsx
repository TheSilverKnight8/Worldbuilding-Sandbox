import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BookOpen, Link2, Plus, Unlink, X } from 'lucide-react';
import { Button, IconButton, Input, Select } from '../components/ui';
import { NODE_KINDS, defaultNodeKind, defaultNodeName, type NodeTarget } from '../lib/map/nodes';
import { KINDS } from '../lib/map/terrain';
import { TEXT_STYLES } from '../lib/map/text';
import { KIND_LABEL, type EntryKind } from '../lib/world/entries';
import type { MapInfo, WorldDoc } from '../lib/world/types';

interface Props {
  world: WorldDoc;
  map: MapInfo;
  /** The icon or text picked on the map. */
  target: NodeTarget | null;
  onCreate: (kind: EntryKind, name: string) => void;
  onLink: (entryId: string) => void;
  onUnlink: () => void;
  onDeselect: () => void;
}

/** What the picked item is, in words. */
function describe(map: MapInfo, t: NodeTarget) {
  if (t.kind === 'icon') {
    const i = map.icons.find((q) => q.id === t.id);
    return i ? `${KINDS[i.kind].label} icon` : 'Icon';
  }
  const x = map.texts.find((q) => q.id === t.id);
  return x ? `${TEXT_STYLES[x.kind].label} text “${x.text.replace(/\n/g, ' ')}”` : 'Text';
}

/** Beside the map in Nodes mode: link the picked icon or text to an entry (a new one, or one that exists), or see the entry it is linked to. */
export function NodesPanel({ world, map, target, onCreate, onLink, onUnlink, onDeselect }: Props) {
  const linked = target ? (target.kind === 'icon' ? map.icons.find((i) => i.id === target.id)?.entry : map.texts.find((t) => t.id === target.id)?.entry) : undefined;
  const entry = linked ? world.records[linked] : undefined;
  const [relinking, setRelinking] = useState(false);
  const [kind, setKind] = useState<EntryKind>('settlement');
  const [name, setName] = useState('');
  const [find, setFind] = useState('');
  useEffect(() => {
    setRelinking(false);
    setFind('');
    if (target) {
      setKind(defaultNodeKind(map, target));
      setName(defaultNodeName(map, target));
    }
    // Only when another item is picked, not on every change to the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target?.id]);
  const candidates = useMemo(() => {
    const words = find.toLowerCase().split(/\s+/).filter(Boolean);
    return Object.values(world.records)
      .filter((r) => (NODE_KINDS as readonly string[]).includes(r.kind) && r.id !== linked && words.every((w) => r.name.toLowerCase().includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50);
  }, [world.records, find, linked]);

  const choose = (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">A new entry</h3>
        <label className="block space-y-1">
          <span className="block text-xs text-muted">Type</span>
          <Select value={kind} aria-label="Entry type" className="h-9 w-full text-sm" onChange={(e) => setKind(e.target.value as EntryKind)}>
            {NODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="block text-xs text-muted">Name</span>
          <Input value={name} aria-label="Name" className="h-9 text-sm" onChange={(e) => setName(e.target.value)} />
        </label>
        <Button size="sm" onClick={() => onCreate(kind, name.trim() || `New ${KIND_LABEL[kind].toLowerCase()}`)}>
          <Plus className="size-4" />
          Make the entry and link it
        </Button>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">An entry that exists</h3>
        <Input value={find} aria-label="Find an entry" placeholder="Find by name" className="h-9 text-sm" onChange={(e) => setFind(e.target.value)} />
        {candidates.length ? (
          <ul className="max-h-56 space-y-0.5 overflow-y-auto" aria-label="Entries to link">
            {candidates.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onLink(r.id)} className="flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-raised">
                  <span className="truncate">{r.name || 'Untitled'}</span>
                  <span className="shrink-0 text-xs text-muted">{KIND_LABEL[r.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No settlement, landmark, feature, info node or group{find ? ' with that name' : ' yet'}.</p>
        )}
      </div>
    </div>
  );

  return (
    <aside className="scrollbar-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      {target ? (
        <section className="border-b border-line px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-caps text-accent">{entry ? 'Node' : 'Make it a node'}</h2>
            <IconButton label="Done (Esc)" className="size-7" onClick={onDeselect}>
              <X className="size-4" />
            </IconButton>
          </div>
          <p className="mb-3 text-xs text-muted">{describe(map, target)}</p>
          {entry && !relinking ? (
            <div className="space-y-3">
              <p className="text-sm">
                Linked to <span className="font-medium">{entry.name || 'Untitled'}</span> <span className="text-muted">({KIND_LABEL[entry.kind]})</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Link to={`/world/${world.id}/entries/${entry.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-navy px-3 text-sm font-medium text-on-accent hover:bg-navy/90">
                  <BookOpen className="size-4" />
                  Open the entry
                </Link>
                <Button size="sm" variant="secondary" onClick={() => setRelinking(true)}>
                  <Link2 className="size-4" />
                  Link another
                </Button>
                <Button size="sm" variant="secondary" onClick={onUnlink}>
                  <Unlink className="size-4" />
                  Unlink
                </Button>
              </div>
            </div>
          ) : (
            choose
          )}
        </section>
      ) : null}
      <section className="px-4 py-4">
        <h2 className="label-caps mb-2 text-muted">Nodes</h2>
        <p className="text-xs text-muted">
          A node is an icon or a piece of text on the map that stands for an entry: a settlement, landmark, feature, info node or group. Click one to link it to a new entry or one that exists; it moves, and is deleted, with the icon or text. The small marks show which are nodes (only in this mode).
        </p>
      </section>
    </aside>
  );
}
