import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { mergeAttributes, type Editor } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type ReactNodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote } from 'lucide-react';
import { cx } from '../components/ui';
import { getState, updateEntry, useApp } from '../lib/store';
import { KIND_LABEL, isEntryKind } from '../lib/world/entries';
import type { WorldRecord } from '../lib/world/types';

// Free write (Stage 7): simple formatting (headings, bold, italic, lists, quotes) and links to
// other entries, typed as [[ and a name. Stored as HTML on the record; the editor's schema
// only lets these through, so nothing else in a stored text (from an imported file, say) is
// ever shown or run. A link stores the entry's ID; it shows the entry's current name.

/** A link to another entry, inside the text: shows the entry's current name; clicking it opens the entry. */
function EntryLinkView({ node }: ReactNodeViewProps) {
  const id = String(node.attrs.id ?? '');
  const navigate = useNavigate();
  const world = useApp((s) => (s.open.kind === 'ready' ? s.open.world : null));
  const target = world?.records[id];
  return (
    <NodeViewWrapper
      as="span"
      className={cx('entry-link', !target && 'entry-link-missing')}
      data-entry-link={id}
      title={target ? `Open ${target.name || 'Untitled'}` : 'This entry was deleted'}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        if (target && world) navigate(`/world/${world.id}/entries/${id}`);
      }}
    >
      {target ? target.name || 'Untitled' : 'Deleted entry'}
    </NodeViewWrapper>
  );
}

const EntryLink = Mention.extend({
  name: 'entryLink',
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-entry-link'),
        renderHTML: (attrs: { id?: string | null }) => (attrs.id ? { 'data-entry-link': attrs.id } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-entry-link]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    // The name at the time of saving is kept inside, for anyone reading the file; the page always shows the current one.
    const world = getState().open;
    const name = world.kind === 'ready' ? world.world.records[String(node.attrs.id)]?.name : undefined;
    return ['span', mergeAttributes({ class: 'entry-link' }, HTMLAttributes), name ?? ''];
  },
  renderText({ node }) {
    const world = getState().open;
    return (world.kind === 'ready' ? world.world.records[String(node.attrs.id)]?.name : undefined) ?? '';
  },
  addNodeView() {
    return ReactNodeViewRenderer(EntryLinkView, { as: 'span' });
  },
});

interface Suggest {
  items: WorldRecord[];
  index: number;
  rect: DOMRect | null;
  command: ((r: WorldRecord) => void) | null;
}

const noSuggest: Suggest = { items: [], index: 0, rect: null, command: null };

/** Entries whose names match what was typed after [[ (names starting with it first). */
function matchEntries(query: string, except: string): WorldRecord[] {
  const s = getState().open;
  if (s.kind !== 'ready') return [];
  const q = query.trim().toLowerCase();
  const list = Object.values(s.world.records).filter((r) => r.id !== except && isEntryKind(r.kind) && (!q || r.name.toLowerCase().includes(q)));
  const rank = (r: WorldRecord) => (q && r.name.toLowerCase().startsWith(q) ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 8);
}

/** An entry's free write, edited in place. Saves itself as it is typed. */
export function FreeWrite({ entry, className }: { entry: WorldRecord; className?: string }) {
  const [suggest, setSuggest] = useState<Suggest>(noSuggest);
  // The suggestion plugin's callbacks live in the editor, made once: they reach this component through a ref.
  const live = useRef({ setSuggest, suggest });
  live.current = { setSuggest, suggest };
  const save = useRef<{ timer: number; html: string | null }>({ timer: 0, html: null });
  const flush = () => {
    window.clearTimeout(save.current.timer);
    if (save.current.html !== null) updateEntry(entry.id, { text: save.current.html });
    save.current.html = null;
  };

  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, horizontalRule: false, strike: false, link: false, underline: false }),
      Placeholder.configure({ placeholder: 'Write about this entry. Type [[ to link another entry.' }),
      EntryLink.configure({
        suggestion: {
          char: '[[',
          allowSpaces: true,
          allowedPrefixes: null,
          items: ({ query }) => matchEntries(query, entry.id),
          command: ({ editor, range, props }) => {
            const r = props as unknown as WorldRecord;
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: 'entryLink', attrs: { id: r.id } },
                { type: 'text', text: ' ' },
              ])
              .run();
          },
          render: () => {
            const show = (p: SuggestionProps) =>
              live.current.setSuggest({ items: p.items as WorldRecord[], index: 0, rect: p.clientRect?.() ?? null, command: (r) => p.command(r as never) });
            return {
              onStart: show,
              onUpdate: show,
              onExit: () => live.current.setSuggest(noSuggest),
              onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                const s = live.current.suggest;
                if (!s.items.length) return false;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  live.current.setSuggest({ ...s, index: (s.index + step + s.items.length) % s.items.length });
                  return true;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  s.command?.(s.items[s.index]);
                  return true;
                }
                if (event.key === 'Escape') {
                  live.current.setSuggest(noSuggest);
                  return true;
                }
                return false;
              },
            };
          },
        },
      }),
    ],
    [entry.id],
  );

  const editor = useEditor(
    {
      extensions,
      content: entry.text ?? '',
      editorProps: { attributes: { class: 'entry-prose', 'aria-label': 'Free write' } },
      onUpdate: ({ editor: e }) => {
        save.current.html = e.getHTML();
        window.clearTimeout(save.current.timer);
        save.current.timer = window.setTimeout(flush, 400);
      },
    },
    [entry.id],
  );
  // Save what is pending when leaving the entry.
  useEffect(() => () => flush(), [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={className}>
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
      {suggest.rect && (
        <div className="fixed z-50 w-72 overflow-hidden rounded-xl border border-line bg-surface py-1 font-sans text-sm text-ink shadow-pop" style={{ left: suggest.rect.left, top: suggest.rect.bottom + 4 }} role="listbox" aria-label="Link an entry">
          {suggest.items.length ? (
            suggest.items.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={i === suggest.index}
                className={cx('flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left', i === suggest.index ? 'bg-navy text-on-accent' : 'hover:bg-raised')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  suggest.command?.(r);
                }}
              >
                <span className="truncate">{r.name || 'Untitled'}</span>
                <span className={cx('shrink-0 text-xs', i === suggest.index ? 'text-on-accent/80' : 'text-muted')}>{KIND_LABEL[r.kind]}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-1.5 text-muted">No entry by that name.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  // Redraw when the selection or formatting changes, so the buttons show what is on.
  const [, setTick] = useState(0);
  useEffect(() => {
    const tick = () => setTick((t) => t + 1);
    editor.on('transaction', tick);
    return () => void editor.off('transaction', tick);
  }, [editor]);
  const button = (label: string, icon: React.ReactNode, active: boolean, run: () => void) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cx('flex size-8 items-center justify-center rounded-lg transition', active ? 'bg-navy text-on-accent' : 'text-muted hover:bg-raised hover:text-ink')}
    >
      {icon}
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="entry-toolbar mb-2 flex flex-wrap items-center gap-0.5 rounded-xl border border-line bg-surface/90 p-1 font-sans" role="toolbar" aria-label="Formatting">
      {button('Heading', <Heading2 className="size-4" />, editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run())}
      {button('Subheading', <Heading3 className="size-4" />, editor.isActive('heading', { level: 3 }), () => c().toggleHeading({ level: 3 }).run())}
      <span className="mx-1 h-5 w-px bg-line" />
      {button('Bold (Ctrl+B)', <Bold className="size-4" />, editor.isActive('bold'), () => c().toggleBold().run())}
      {button('Italic (Ctrl+I)', <Italic className="size-4" />, editor.isActive('italic'), () => c().toggleItalic().run())}
      <span className="mx-1 h-5 w-px bg-line" />
      {button('Bulleted list', <List className="size-4" />, editor.isActive('bulletList'), () => c().toggleBulletList().run())}
      {button('Numbered list', <ListOrdered className="size-4" />, editor.isActive('orderedList'), () => c().toggleOrderedList().run())}
      {button('Quote', <Quote className="size-4" />, editor.isActive('blockquote'), () => c().toggleBlockquote().run())}
      <span className="mx-1 h-5 w-px bg-line" />
      {button('Link an entry ([[)', <Link2 className="size-4" />, false, () => c().insertContent('[[').run())}
    </div>
  );
}
