import { useEffect } from 'react';
import { useParams } from 'react-router';
import { AlertTriangle, ArrowLeft, Globe2 } from 'lucide-react';
import { ButtonLink, Spinner } from '../components/ui';
import { closeWorld, openWorld, useApp } from '../lib/store';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** Inside one world. Stage 1 opens and saves it; the map and everything on it come in the next stages. */
export function WorldPage() {
  const { id = '' } = useParams();
  const open = useApp((s) => s.open);

  useEffect(() => {
    void openWorld(id);
  }, [id]);
  // Leaving the world screen saves and lets go of the world.
  useEffect(() => () => void closeWorld(), []);

  if (open.kind === 'ready' && open.world.id === id)
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="max-w-lg animate-rise">
          <span className="mx-auto flex size-14 items-center justify-center rounded-xl bg-navy text-on-accent">
            <Globe2 className="size-7" />
          </span>
          <h1 className="mt-5 text-5xl">{open.world.name}</h1>
          <p className="mt-2 text-muted">Created {dateFormat.format(new Date(open.world.createdAt))}</p>
          <p className="mt-6 text-sm text-muted">The map comes in Stage 2: the backdrop image, then painting land, ocean and biomes.</p>
        </div>
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
