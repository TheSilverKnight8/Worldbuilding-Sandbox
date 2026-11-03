import { useEffect } from 'react';
import { useParams } from 'react-router';
import { AlertTriangle, ArrowLeft, X } from 'lucide-react';
import { ButtonLink, Spinner } from '../components/ui';
import { closeWorld, dismissNotice, openWorld, useApp } from '../lib/store';
import { MapEditor } from '../map/MapEditor';
import { MapSetup } from '../map/MapSetup';

/** Inside one world: the map (or setting it up). */
export function WorldPage() {
  const { id = '' } = useParams();
  const open = useApp((s) => s.open);
  const notice = useApp((s) => s.notice);

  useEffect(() => {
    void openWorld(id);
  }, [id]);
  // Leaving the world screen saves and lets go of the world.
  useEffect(() => () => void closeWorld(), []);

  if (open.kind === 'ready' && open.world.id === id)
    return (
      <div className="relative h-full">
        {open.world.map ? <MapEditor world={open.world} map={open.world.map} /> : <MapSetup />}
        {notice && (
          <div role="status" className="absolute left-1/2 top-16 z-20 flex max-w-lg -translate-x-1/2 items-start gap-2 rounded-xl border border-warn/40 bg-surface px-4 py-3 text-sm shadow-pop">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <span className="flex-1">{notice}</span>
            <button aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={dismissNotice}>
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>
    );

  if (open.kind === 'missing' || open.kind === 'elsewhere' || open.kind === 'error')
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="max-w-lg animate-rise">
          <AlertTriangle className="mx-auto size-8 text-warn" />
          <h1 className="mt-4 text-4xl">
            {open.kind === 'missing' ? 'This world is not here' : open.kind === 'elsewhere' ? 'Open in another window' : 'This world could not be opened'}
          </h1>
          <p className="mt-3 text-muted">
            {open.kind === 'missing'
              ? 'It may have been deleted. Your worlds are listed on the Worlds page.'
              : open.kind === 'elsewhere'
                ? 'This world is already open in another tab or window of the app. Close it there, then reload this page. (Two copies open at once would save over each other.)'
                : open.message}
          </p>
          <ButtonLink to="/" className="mt-6">
            <ArrowLeft className="size-4" />
            Back to worlds
          </ButtonLink>
        </div>
      </div>
    );

  return (
    <div className="flex h-full items-center justify-center gap-3 text-muted">
      <Spinner />
      Opening
    </div>
  );
}
