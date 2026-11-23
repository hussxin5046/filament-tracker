import { useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRightLeft, ChevronRight, CircleAlert, CircleCheck, MapPin, Minus, PackageOpen, PackageSearch, Plus, ScanLine, X } from 'lucide-react';
import { stepsFor } from '@/components/items/ItemSheet';
import { StockMeter } from '@/components/items/StockMeter';
import { useScanHandler } from '@/components/scan/ScannerProvider';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, List, Loading, Muted, Row, SectionTitle } from '@/components/ui/Display';
import { NumberField, SelectField, TextField } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { useStockChange } from '@/hooks/useUndo';
import { api } from '@/lib/api';
import { formatNumber, formatQuantity, isLow, locationPath, parseNumber } from '@/lib/format';
import { handheldItemPath, handheldLocationPath, readHandheldScan } from '@/lib/handheld';
import { refreshAll } from '@/lib/store';
import type { Item, Location } from '@/lib/types';
import itemStyles from '@/components/items/Items.module.css';
import styles from '@/pages/HandheldPages.module.css';

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true });
const matches = (text: string, query: string) => text.toLowerCase().includes(query);

interface Note {
  id: number;
  text: string;
  tone: 'ok' | 'danger';
}

/** The last few things a run of scans did, newest first. */
function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const next = useRef(1);
  const add = (text: string, tone: Note['tone'] = 'ok') => setNotes((current) => [{ id: next.current++, text, tone }, ...current].slice(0, 8));
  return { notes, add };
}

function Notes({ notes }: { notes: Note[] }) {
  if (!notes.length) return null;
  return (
    <ul className={styles.notes} aria-live="polite">
      {notes.map((note) => (
        <li key={note.id} className={note.tone === 'danger' ? styles.danger : styles.ok}>
          {note.tone === 'danger' ? <CircleAlert size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
          {note.text}
        </li>
      ))}
    </ul>
  );
}

/** Find: scan anything, or search the items and locations by name or code. */
export function HandheldHomePage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const { items, loading } = useItems();
  const { locations, unitById } = useCatalog();
  const needle = query.trim().toLowerCase();

  const found = useMemo(() => {
    if (!needle) return { items: [] as Item[], locations: [] as Location[] };
    return {
      items: items.filter((item) => matches(item.name, needle) || (item.sku && matches(item.sku, needle))).sort(byName).slice(0, 40),
      locations: locations.filter((location) => matches(location.name, needle) || (location.code && matches(location.code, needle))).sort(byName).slice(0, 20),
    };
  }, [items, locations, needle]);

  const setQuery = (text: string) => setParams(text ? { q: text } : {}, { replace: true });

  return (
    <div className={styles.page}>
      <div className={styles.prompt}>
        <ScanLine size={28} aria-hidden />
        <div>
          <h1 className={styles.heading}>Scan a label</h1>
          <Muted>Pull the trigger on any screen. Item and location labels, makers' barcodes and location codes all work.</Muted>
        </div>
      </div>
      <TextField label="Or find by name or code" value={query} onChange={setQuery} type="search" enterKeyHint="search" autoComplete="off" autoCapitalize="off" data-scan="capture" />
      {loading && !items.length ? (
        <Loading />
      ) : needle ? (
        <>
          {found.locations.length > 0 && (
            <>
              <SectionTitle count={found.locations.length}>Locations</SectionTitle>
              <List>
                {found.locations.map((location) => (
                  <Row key={location.id} to={handheldLocationPath(location.id)} leading={<MapPin size={18} aria-hidden />} title={location.name} subtitle={locationPath(location.parentId, locations) || location.kind} />
                ))}
              </List>
            </>
          )}
          <SectionTitle count={found.items.length}>Items</SectionTitle>
          {found.items.length ? (
            <List>
              {found.items.map((item) => (
                <ItemRow key={item.id} item={item} subtitle={locationPath(item.locationId, locations) || 'No location'} unit={item.unitId ? unitById.get(item.unitId) : undefined} />
              ))}
            </List>
          ) : (
            <Muted>No item matches "{query.trim()}".</Muted>
          )}
        </>
      ) : null}
    </div>
  );
}

function ItemRow({ item, subtitle, unit }: { item: Item; subtitle?: string; unit: Parameters<typeof formatQuantity>[1] }) {
  return <Row to={handheldItemPath(item.id)} title={item.name} subtitle={subtitle} trailing={formatQuantity(item.quantity, unit)} flagged={isLow(item) ? 'danger' : false} />;
}

/** Every top-level location, to walk down from. */
export function HandheldLocationsPage() {
  const { items } = useItems();
  const { locations, loading } = useCatalog();
  const top = locations.filter((location) => !location.parentId || !locations.some((other) => other.id === location.parentId)).sort(byName);
  const count = (id: string) => items.filter((item) => item.locationId === id).length;

  if (loading && !locations.length) return <Loading />;
  if (!locations.length) {
    return (
      <EmptyState icon={MapPin} title="No locations yet">
        Add shelves and bins in the full Wrkbench, then print their labels.
      </EmptyState>
    );
  }
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Locations</h1>
      <List>
        {top.map((location) => (
          <Row key={location.id} to={handheldLocationPath(location.id)} leading={<MapPin size={18} aria-hidden />} title={location.name} subtitle={[location.kind, count(location.id) ? `${count(location.id)} items directly here` : ''].filter(Boolean).join(' · ')} trailing={<ChevronRight size={18} aria-hidden />} />
        ))}
      </List>
    </div>
  );
}

/** One item: how much there is, using some, setting the exact amount, and moving it. */
export function HandheldItemPage() {
  const { id = '' } = useParams();
  const { canEdit, canOperate, wsPath } = useWorkspace();
  const toast = useToast();
  const stock = useStockChange();
  const { items, loading } = useItems();
  const { locations, unitById, typeById } = useCatalog();
  const [exact, setExact] = useState('');
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const item = items.find((candidate) => candidate.id === id);

  const moveTo = async (location: Location) => {
    if (!item) return;
    if (item.locationId === location.id) {
      toast(`${item.name} is already in ${location.name}.`);
      setMoving(false);
      return;
    }
    setBusy(true);
    try {
      await api.post(wsPath('/items/move')!, { itemIds: [item.id], locationId: location.id });
      refreshAll();
      toast(`Moved ${item.name} to ${location.name}`, 'ok');
      setMoving(false);
      setTarget('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Something went wrong', 'danger');
    } finally {
      setBusy(false);
    }
  };

  // While moving, the next location label scanned is where it goes.
  useScanHandler(
    moving
      ? (raw) => {
          navigator.vibrate?.(40);
          const found = readHandheldScan(raw, items, locations);
          if (found.kind === 'location') void moveTo(found.location);
          else toast(found.kind === 'problem' ? found.message : 'That is an item. Scan the label of the location to move it to.', 'danger');
        }
      : null,
  );

  if (!item) {
    if (loading) return <Loading />;
    return (
      <EmptyState icon={PackageSearch} title="This item is not here" action={<Link to="/handheld"><Button variant="primary">Back to Find</Button></Link>}>
        It may have been deleted, or it belongs to another workspace.
      </EmptyState>
    );
  }

  const unit = item.unitId ? unitById.get(item.unitId) : undefined;
  const type = typeById.get(item.itemTypeId);
  const low = isLow(item);
  const where = locationPath(item.locationId, locations);
  const sortedLocations = locations.map((location) => ({ location, path: locationPath(location.id, locations) })).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

  const adjust = (delta: number) => stock.change(item.id, { mode: 'delta', value: delta }, `${delta < 0 ? 'Used' : 'Added'} ${formatQuantity(Math.abs(delta), unit)}`);
  const setTo = async () => {
    const value = parseNumber(exact);
    if (value === null || value < 0) return;
    if (await stock.change(item.id, { mode: 'set', value, note: 'Counted / weighed' }, 'Stock level set')) setExact('');
  };

  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.heading}>{item.name}</h1>
        <Muted>
          {[type?.name, item.sku].filter(Boolean).join(' · ')}
        </Muted>
        {low && (
          <div className={styles.badges}>
            <Badge tone="danger">Low stock</Badge>
          </div>
        )}
      </div>

      {item.locationId ? (
        <Link to={handheldLocationPath(item.locationId)} className={styles.where}>
          <MapPin size={18} aria-hidden /> {where}
        </Link>
      ) : (
        <p className={styles.where}>
          <MapPin size={18} aria-hidden /> No location
        </p>
      )}

      <div className={itemStyles.stock}>
        <div className={itemStyles.stockFigure}>
          <span className={`${itemStyles.stockValue} ${low ? itemStyles.stockLow : ''}`}>{formatNumber(item.quantity, unit?.decimals ?? 2)}</span>
          <span className={itemStyles.stockUnit}>{unit?.symbol}</span>
        </div>
        <StockMeter item={item} />
        {canOperate && (
          <>
            <div className={itemStyles.steps}>
              {stepsFor(item, unit)
                .slice()
                .reverse()
                .map((step) => (
                  <Button key={`minus-${step}`} size="lg" icon={Minus} disabled={stock.busy || item.quantity <= 0} onClick={() => adjust(-step)} aria-label={`Use ${step} ${unit?.symbol ?? ''}`}>
                    {formatNumber(step, 1)}
                  </Button>
                ))}
              {canEdit &&
                stepsFor(item, unit).map((step) => (
                  <Button key={`plus-${step}`} size="lg" icon={Plus} disabled={stock.busy} onClick={() => adjust(step)} aria-label={`Add ${step} ${unit?.symbol ?? ''}`}>
                    {formatNumber(step, 1)}
                  </Button>
                ))}
            </div>
            <form
              className={itemStyles.exact}
              onSubmit={(event) => {
                event.preventDefault();
                void setTo();
              }}
            >
              <NumberField
                label="Counted or weighed? Set the exact amount"
                value={exact}
                onChange={setExact}
                suffix={unit?.symbol}
                placeholder={String(item.quantity)}
                data-scan="capture"
                hint={canEdit ? undefined : 'Operators can only lower the amount. Ask an admin to add stock.'}
              />
              <Button type="submit" variant="primary" disabled={stock.busy || parseNumber(exact) === null}>
                Set
              </Button>
            </form>
          </>
        )}
      </div>

      {canOperate &&
        (moving ? (
          <section className={styles.panel} aria-label="Move">
            <p className={styles.panelTitle}>
              <ScanLine size={18} aria-hidden /> Scan the label of the location to move it to
            </p>
            <form
              className={styles.pick}
              onSubmit={(event) => {
                event.preventDefault();
                const chosen = locations.find((location) => location.id === target);
                if (chosen) void moveTo(chosen);
              }}
            >
              <SelectField label="Or pick one" value={target} onChange={setTarget}>
                <option value="">Choose a location</option>
                {sortedLocations.map(({ location, path }) => (
                  <option key={location.id} value={location.id}>
                    {path}
                  </option>
                ))}
              </SelectField>
              <Button type="submit" variant="primary" disabled={busy || !target}>
                Move
              </Button>
            </form>
            <Button icon={X} onClick={() => setMoving(false)}>
              Cancel
            </Button>
          </section>
        ) : (
          <Button block size="lg" icon={ArrowRightLeft} onClick={() => setMoving(true)}>
            Move to another location
          </Button>
        ))}

      <Link to={`/inventory?item=${encodeURIComponent(item.id)}`} className={styles.fullLink}>
        Open in the full Wrkbench
      </Link>
    </div>
  );
}

/** One location: what is inside it, and putting things away by scanning them. */
export function HandheldLocationPage() {
  const { id = '' } = useParams();
  const { canOperate, wsPath } = useWorkspace();
  const { items } = useItems();
  const { locations, locationById, unitById, loading } = useCatalog();
  const [puttingAway, setPuttingAway] = useState(false);
  const { notes, add } = useNotes();
  const current = locationById.get(id);

  const putAway = async (raw: string) => {
    if (!current) return;
    navigator.vibrate?.(40);
    const found = readHandheldScan(raw, items, locations);
    if (found.kind === 'problem') return add(found.message, 'danger');
    if (found.kind === 'location') return add(found.location.id === current.id ? `That is the label for ${current.name} itself. Scan the items to put here.` : 'That is a location label. Scan the items to put here.', 'danger');
    if (found.kind === 'several') return add(`${found.items.length} items have this code. Scan the item's own Wrkbench label.`, 'danger');
    const item = found.item;
    if (item.locationId === current.id) return add(`${item.name} is already here.`);
    try {
      await api.post(wsPath('/items/move')!, { itemIds: [item.id], locationId: current.id });
      refreshAll();
      add(`Moved ${item.name} here.`);
    } catch (error) {
      add(error instanceof Error ? error.message : 'Something went wrong', 'danger');
    }
  };

  useScanHandler(puttingAway ? (raw) => void putAway(raw) : null);

  if (!current) {
    if (loading) return <Loading />;
    return (
      <EmptyState icon={MapPin} title="This location is not here" action={<Link to="/handheld/locations"><Button variant="primary">All locations</Button></Link>}>
        It may have been deleted, or it belongs to another workspace.
      </EmptyState>
    );
  }

  const children = locations.filter((location) => location.parentId === current.id).sort(byName);
  const here = items.filter((item) => item.locationId === current.id).sort(byName);
  const trail: Location[] = [];
  for (let cursor = current.parentId ? locationById.get(current.parentId) : undefined; cursor && !trail.includes(cursor); cursor = cursor.parentId ? locationById.get(cursor.parentId) : undefined) trail.unshift(cursor);

  return (
    <div className={styles.page}>
      {trail.length > 0 && (
        <nav className={styles.crumbs} aria-label="Where this is">
          {trail.map((location) => (
            <span key={location.id}>
              <Link to={handheldLocationPath(location.id)}>{location.name}</Link> <ChevronRight size={14} aria-hidden />
            </span>
          ))}
        </nav>
      )}
      <div>
        <h1 className={styles.heading}>{current.name}</h1>
        <Muted>{[current.kind, current.code].filter(Boolean).join(' · ')}</Muted>
      </div>

      {canOperate &&
        (puttingAway ? (
          <section className={styles.panel} aria-label="Put away">
            <p className={styles.panelTitle}>
              <ScanLine size={18} aria-hidden /> Scan each item to put in {current.name}
            </p>
            <Notes notes={notes} />
            <Button icon={X} onClick={() => setPuttingAway(false)}>
              Done
            </Button>
          </section>
        ) : (
          <Button block size="lg" icon={PackageOpen} onClick={() => setPuttingAway(true)}>
            Put items away here
          </Button>
        ))}

      {children.length > 0 && (
        <>
          <SectionTitle count={children.length}>Inside</SectionTitle>
          <List>
            {children.map((location) => (
              <Row key={location.id} to={handheldLocationPath(location.id)} leading={<MapPin size={18} aria-hidden />} title={location.name} subtitle={location.kind} trailing={<ChevronRight size={18} aria-hidden />} />
            ))}
          </List>
        </>
      )}

      <SectionTitle count={here.length}>Items here</SectionTitle>
      {here.length ? (
        <List>
          {here.map((item) => (
            <ItemRow key={item.id} item={item} subtitle={item.sku || undefined} unit={item.unitId ? unitById.get(item.unitId) : undefined} />
          ))}
        </List>
      ) : (
        <Muted>Nothing is stored directly here.</Muted>
      )}
    </div>
  );
}
