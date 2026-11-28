import { Link, useNavigate } from 'react-router';
import { MapPin } from 'lucide-react';
import { NODE_KINDS, PLACE_KINDS, nodesOf, spotFacts, type NodeSpot } from '../lib/map/nodes';
import { getMap, getMapVersion } from '../lib/store';
import { formatNumber, type EntryKind } from '../lib/world/entries';
import type { WorldDoc, WorldRecord } from '../lib/world/types';

// An entry's place on the map (Stage 8): the icons and text linked to it (its nodes), with a way
// to see each on the map; and, for place entries (settlements, landmarks, features), the biome
// and elevation at its spot, read from the map (SPEC.md), never stored.

/** The biome and elevation at a place entry's spot (its first node), as rows among its fields. */
export function PlaceFacts({ entry, doc }: { entry: WorldRecord; doc: WorldDoc }) {
  if (!(PLACE_KINDS as readonly string[]).includes(entry.kind)) return null;
  const data = getMap();
  const spots = doc.map ? nodesOf(doc.map, entry.id) : [];
  const facts = data && spots[0] ? spotFacts(doc, data, getMapVersion(), spots[0].x, spots[0].y) : null;
  const biome = facts?.biome ? doc.records[facts.biome] : undefined;
  const none = <span className="entry-muted">{doc.map ? 'From the map, once it is on it (see On the map).' : 'From the map, once the world has one.'}</span>;
  return (
    <>
      <div className="entry-field">
        <span className="entry-label">Biome</span>
        <span className="entry-value" data-testid="place-biome">
          {!facts ? (
            none
          ) : biome ? (
            <Link to={`/world/${doc.id}/entries/${biome.id}`} className="entry-backlink">
              {biome.name || 'Untitled'}
            </Link>
          ) : (
            <span className="entry-muted">{facts.land ? 'None painted here' : 'None: the spot is on water'}</span>
          )}
        </span>
      </div>
      <div className="entry-field">
        <span className="entry-label">Elevation</span>
        <span className="entry-value" data-testid="place-elevation">
          {!facts ? none : facts.land ? `${formatNumber(facts.elevation)} m` : <span className="entry-muted">Sea level: the spot is on water</span>}
          {facts && spots.length > 1 && <span className="entry-muted"> (at its first node)</span>}
        </span>
      </div>
    </>
  );
}

/** The entry's nodes: the icons and text on the map linked to it. */
export function OnTheMap({ entry, doc }: { entry: WorldRecord; doc: WorldDoc }) {
  const navigate = useNavigate();
  if (!(NODE_KINDS as readonly string[]).includes(entry.kind as EntryKind)) return null;
  const spots = doc.map ? nodesOf(doc.map, entry.id) : [];
  const show = (s: NodeSpot) => navigate(`/world/${doc.id}`, { state: { focus: { x: s.x, y: s.y, node: { kind: s.kind, id: s.id } } } });
  return (
    <section className="entry-section" aria-label="On the map">
      <h2 className="entry-h">On the map</h2>
      {spots.length ? (
        <ul className="entry-backlinks">
          {spots.map((s) => (
            <li key={`${s.kind}:${s.id}`}>
              <span>{s.label}</span>{' '}
              <button type="button" className="entry-backlink inline-flex items-center gap-1" onClick={() => show(s)}>
                <MapPin className="size-3.5" />
                Show on the map
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="entry-muted">{doc.map ? 'Not on the map yet. In the map’s Nodes mode, click an icon or text to link it to this entry.' : 'This world has no map yet.'}</p>
      )}
    </section>
  );
}
