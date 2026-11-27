import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Star, Trash2, X } from 'lucide-react';
import { alertDialog, confirmDialog } from '../components/dialogs';
import { cx } from '../components/ui';
import { addEntryImages, readImage, removeEntryImage, setEntryCover } from '../lib/store';
import type { WorldRecord } from '../lib/world/types';

// An entry's images (Stage 7): a gallery, the first image being the entry's cover (Caleb's
// choice). Images are stored with the world, apart from the record, and go with it in exports.

const urls = new Map<string, string>();

/** A stored image, ready to show (null while loading, or if it is gone). */
export function useImageUrl(blobId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (blobId ? (urls.get(blobId) ?? null) : null));
  useEffect(() => {
    if (!blobId) return setUrl(null);
    const hit = urls.get(blobId);
    if (hit) return setUrl(hit);
    let live = true;
    void readImage(blobId).then((b) => {
      if (!b || !live) return;
      const u = URL.createObjectURL(b);
      urls.set(blobId, u);
      setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [blobId]);
  return url;
}

export function Thumb({ blobId, className, alt = '' }: { blobId: string; className?: string; alt?: string }) {
  const url = useImageUrl(blobId);
  return url ? <img src={url} alt={alt} className={className} draggable={false} /> : <span className={cx('block bg-raised', className)} />;
}

export function Gallery({ entry }: { entry: WorldRecord }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const images = entry.images ?? [];

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const r = await addEntryImages(entry.id, [...files]);
    setBusy(false);
    if (!r.ok) void alertDialog({ title: 'Could not add the images', body: r.reason });
    else if (r.value) void alertDialog({ title: r.value === files.length ? 'No images added' : 'Some files were not added', body: `${r.value} of the files ${r.value === 1 ? 'is' : 'are'} not an image this browser can read.` });
  };

  return (
    <div>
      {images.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {images.map((id, i) => (
            <figure key={id} className="entry-thumb group relative">
              <button type="button" className="block w-full" onClick={() => setViewing(id)} aria-label={`View image ${i + 1}`}>
                <Thumb blobId={id} className="aspect-[4/3] w-full object-cover" />
              </button>
              {i === 0 && <figcaption className="entry-cover-tag">Cover</figcaption>}
              <span className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                {i > 0 && (
                  <button type="button" className="entry-thumb-button" title="Make this the cover" aria-label={`Make image ${i + 1} the cover`} onClick={() => setEntryCover(entry.id, id)}>
                    <Star className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  className="entry-thumb-button"
                  title="Remove"
                  aria-label={`Remove image ${i + 1}`}
                  onClick={async () => {
                    if (await confirmDialog({ title: 'Remove this image?', body: 'It is deleted from the world.', confirm: 'Remove', danger: true })) void removeEntryImage(entry.id, id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </figure>
          ))}
        </div>
      )}
      <input ref={input} type="file" accept="image/*" multiple className="hidden" aria-label="Image files" onChange={(e) => void add(e.target.files).then(() => (e.target.value = ''))} />
      <button type="button" className="entry-add mt-3" disabled={busy} onClick={() => input.current?.click()}>
        <ImagePlus className="size-4" />
        {busy ? 'Adding…' : images.length ? 'Add images' : 'Add images (the first is the cover)'}
      </button>
      {viewing && (
        <div role="dialog" aria-label="Image" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-8" onClick={() => setViewing(null)}>
          <Thumb blobId={viewing} className="max-h-full max-w-full rounded-lg shadow-pop" />
          <button type="button" aria-label="Close" className="absolute right-5 top-5 rounded-full bg-surface p-2 text-ink" onClick={() => setViewing(null)}>
            <X className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
