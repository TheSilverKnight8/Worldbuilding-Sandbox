import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { cx } from '../components/ui';
import { ICON_SETS, biomeFields } from '../lib/map/biomes';
import { paperTexture } from '../lib/map/paper';
import { updateBiome, updateEntry } from '../lib/store';
import { FIELDS, KIND_LABEL, backlinks, formatNumber, nationSettlements, readRefs, type EntryKind } from '../lib/world/entries';
import type { IconSet, WorldDoc, WorldRecord } from '../lib/world/types';
import { FieldEditor } from './fields';
import { FreeWrite } from './FreeWrite';
import { Gallery, useImageUrl } from './Gallery';
import { OnTheMap, PlaceFacts } from './OnTheMap';
import { PLACE_KINDS } from '../lib/map/nodes';

// An entry's page (Stage 7), in the world's look (SPEC.md: entry pages follow the style toggle):
// on the atlas, a printed page on the map's parchment, in ink, with old-print type; on the
// painterly map, a bright page with a wash of color across its head. The page is the editor:
// every field and the free write can be changed in place.

/** The wash across a painterly page's head, by type. */
const KIND_COLOR: Record<EntryKind, string> = {
  settlement: '#c8553d',
  nation: '#2d6a8a',
  culture: '#8a5a9e',
  language: '#3f8f7a',
  faction: '#b07a2e',
  feature: '#4f8a3a',
  landmark: '#9b3d4a',
  road: '#7a6a55',
  info: '#5a6f8f',
  group: '#6b7d3a',
  biome: '#5f8f4e',
};

let paperUrl: string | null = null;
const paper = () => (paperUrl ??= paperTexture().toDataURL('image/png'));

export type Look = 'atlas' | 'painterly';

export function EntryPage({ entry, doc, look }: { entry: WorldRecord; doc: WorldDoc; look: Look }) {
  const kind = entry.kind as EntryKind;
  const cover = useImageUrl(entry.images?.[0]);
  const color = kind === 'biome' ? biomeFields(entry).color : KIND_COLOR[kind];
  const style: CSSProperties = look === 'atlas' ? { backgroundImage: `url(${paper()})` } : ({ ['--wash' as string]: color } as CSSProperties);
  const links = useMemo(() => backlinks(doc, entry.id), [doc, entry.id]);

  return (
    <article className={cx('entry-page', look === 'atlas' ? 'look-atlas' : 'look-painterly')} style={style} data-testid="entry-page" data-look={look}>
      <div className="entry-head">
        {cover && <img src={cover} alt="" className="entry-cover" />}
        <p className="entry-kind">{KIND_LABEL[kind]}</p>
        <NameField entry={entry} />
        <div className="entry-rule" aria-hidden />
      </div>

      <div className="entry-body">
        {(FIELDS[kind].length > 0 || kind === 'biome' || kind === 'nation' || PLACE_KINDS.includes(kind)) && (
          <section className="entry-facts" aria-label="Fields">
            {kind === 'biome' && <BiomeFields entry={entry} />}
            {FIELDS[kind].map((def) => (
              <div key={def.key} className="entry-field">
                <span className="entry-label">{def.label}</span>
                <span className="entry-value">
                  <FieldEditor def={def} entry={entry} doc={doc} />
                  {kind === 'faction' && def.key === 'nations' && readRefs(entry.fields.nations).length > 0 && (
                    <span className="entry-muted ml-2">
                      In {readRefs(entry.fields.nations).length} {readRefs(entry.fields.nations).length === 1 ? 'nation' : 'nations'}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {kind === 'nation' && <NationTotals doc={doc} id={entry.id} />}
            <PlaceFacts entry={entry} doc={doc} />
          </section>
        )}

        <OnTheMap entry={entry} doc={doc} />

        <section className="entry-section">
          <FreeWrite key={entry.id} entry={entry} />
        </section>

        <section className="entry-section" aria-label="Images">
          <h2 className="entry-h">Images</h2>
          <Gallery entry={entry} />
        </section>

        <section className="entry-section" aria-label="Linked from">
          <h2 className="entry-h">Linked from</h2>
          {links.length ? (
            <ul className="entry-backlinks">
              {links.map(({ record, via }) => (
                <li key={record.id}>
                  <Link to={`/world/${doc.id}/entries/${record.id}`} className="entry-backlink">
                    {record.name || 'Untitled'}
                  </Link>
                  <span className="entry-muted">
                    {' '}
                    · {KIND_LABEL[record.kind]}, {via.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="entry-muted">No other entry links here yet.</p>
          )}
        </section>
      </div>
    </article>
  );
}

/** The entry's name, as the page's title, edited in place. */
function NameField({ entry }: { entry: WorldRecord }) {
  const [name, setName] = useState(entry.name);
  useEffect(() => setName(entry.name), [entry.id, entry.name]);
  // Saved when the field is left, or when the page closes with it still being typed in.
  const latest = useRef({ name, entry });
  latest.current = { name, entry };
  const commit = (value: string) => {
    const e = latest.current.entry;
    if (value === e.name) return;
    if (e.kind === 'biome') updateBiome(e.id, { name: value });
    else updateEntry(e.id, { name: value });
  };
  useEffect(() => () => commit(latest.current.name), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      className="entry-title"
      aria-label="Name"
      value={name}
      placeholder="Untitled"
      onChange={(e) => setName(e.target.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** A biome's color and icons: the same as in the map's biome panel. */
function BiomeFields({ entry }: { entry: WorldRecord }) {
  const f = biomeFields(entry);
  return (
    <>
      <div className="entry-field">
        <span className="entry-label">Color on the painterly map</span>
        <span className="entry-value">
          <input type="color" aria-label="Color" className="entry-swatch" value={f.color} onChange={(e) => updateBiome(entry.id, { color: e.target.value })} />
        </span>
      </div>
      <div className="entry-field">
        <span className="entry-label">Icons</span>
        <span className="entry-value">
          <select aria-label="Icons" className="entry-input" value={f.icons} onChange={(e) => updateBiome(entry.id, { icons: e.target.value as IconSet })}>
            {ICON_SETS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
      </div>
    </>
  );
}

/** A nation's settlements and their total population: shown, not stored (SPEC.md). */
function NationTotals({ doc, id }: { doc: WorldDoc; id: string }) {
  const { list, population, counted } = nationSettlements(doc, id);
  return (
    <>
      <div className="entry-field">
        <span className="entry-label">Settlements</span>
        <span className="entry-value">
          {list.length ? (
            <span className="flex flex-wrap gap-1.5">
              {list.map((r) => (
                <Link key={r.id} to={`/world/${doc.id}/entries/${r.id}`} className="entry-chip">
                  {r.name || 'Untitled'}
                </Link>
              ))}
            </span>
          ) : (
            <span className="entry-muted">None yet: set a settlement's nation to this one.</span>
          )}
        </span>
      </div>
      <div className="entry-field">
        <span className="entry-label">Total population</span>
        <span className="entry-value" data-testid="total-population">
          {counted ? formatNumber(population) : <span className="entry-muted">From its settlements' populations.</span>}
          {counted > 0 && counted < list.length && <span className="entry-muted"> ({counted} of {list.length} settlements counted)</span>}
        </span>
      </div>
    </>
  );
}
