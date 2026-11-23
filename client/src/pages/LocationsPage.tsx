import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, FolderInput, MapPin, MapPinOff, Pencil, Plus, Printer, QrCode, ScanLine, Trash2 } from 'lucide-react';
import { ItemPicker } from '@/components/items/ItemPicker';
import { LabelPrintDialog } from '@/components/labels/LabelPrintDialog';
import { ScanDialog, type ScanNote } from '@/components/scan/ScanDialog';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorNote, Figure, List, Muted, PageHeader, PageSkeleton, Row, SectionTitle, Swatch, TypeIcon } from '@/components/ui/Display';
import { FormGrid, SelectField, TextField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { UNIT_PLACE, flattenLocations, formatQuantity, isPutAway, locationPath, locationScope, summarizeFields } from '@/lib/format';
import { locationLabel, type Label } from '@/lib/labels';
import { refreshAll } from '@/lib/store';
import type { Scan } from '@/lib/scan';
import type { Item, Location, SubUnit } from '@/lib/types';
import styles from '@/pages/LocationsPage.module.css';

/** How many items a list shows before pointing at the inventory for the rest. */
const SHOWN = 40;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

interface FormProps {
  location?: Location;
  /** Where a new location starts out. */
  parentId: string | null;
  locations: Location[];
  onClose: () => void;
  onSaved: (location: Location) => void;
}

function LocationForm({ location, parentId, locations, onClose, onSaved }: FormProps) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const [name, setName] = useState(location?.name ?? '');
  const [kind, setKind] = useState(location?.kind ?? '');
  const [code, setCode] = useState(location?.code ?? '');
  const [inside, setInside] = useState(location ? (location.parentId ?? '') : (parentId ?? ''));
  // A location cannot go inside itself or anything it contains.
  const own = useMemo(() => (location ? locationScope(location.id, locations) : new Set<string>()), [location, locations]);
  const choices = useMemo(() => flattenLocations(locations).filter((candidate) => !own.has(candidate.id)), [locations, own]);

  const save = async () => {
    if (!name.trim()) return;
    const body = { name: name.trim(), kind: kind.trim(), code: code.trim(), parentId: inside || null };
    let saved: Location | undefined;
    const ok = await run(async () => {
      saved = location ? await api.patch<Location>(wsPath(`/locations/${location.id}`)!, body) : await api.post<Location>(wsPath('/locations')!, body);
    }, location ? 'Location saved' : 'Location added');
    if (ok && saved) onSaved(saved);
  };

  return (
    <Modal
      title={location ? `Edit ${location.name}` : 'Add a location'}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {location ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <FormGrid>
        <TextField label="Name" value={name} onChange={setName} placeholder="Shelf B" required autoFocus />
        <TextField label="Kind" value={kind} onChange={setKind} placeholder="Room, shelf, bin…" />
        <SelectField label="Inside" value={inside} onChange={setInside}>
          <option value="">Nothing (top level)</option>
          {choices.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {'  '.repeat(candidate.depth)}
              {candidate.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Label code" value={code} onChange={setCode} placeholder="LOC-014" hint="Optional. A short code of your own, printed on the label and found by the scanner." />
      </FormGrid>
    </Modal>
  );
}

/**
 * Where things are kept: rooms, shelves, drawers and bins, nested as deep as needed. Each location shows what
 * is stored in it, takes items put away into it, and prints a QR label that opens this page when scanned.
 */
export function LocationsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit, canOperate, wsPath } = useWorkspace();
  const catalog = useCatalog();
  const { items, loading, error } = useItems();
  const subUnits = useWsQuery<SubUnit[]>('/sub-units');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [form, setForm] = useState<{ location?: Location } | null>(null);
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [moving, setMoving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const locations = catalog.locations;
  const current = id ? catalog.locationById.get(id) : undefined;
  const tree = useMemo(() => flattenLocations(locations), [locations]);

  /** Per location: what sits directly in it, and what sits in it or anywhere beneath it. */
  const counts = useMemo(() => {
    const direct = new Map<string, number>();
    for (const item of items) if (item.locationId) direct.set(item.locationId, (direct.get(item.locationId) ?? 0) + 1);
    const total = new Map<string, number>();
    for (const location of locations) {
      let sum = 0;
      for (const inside of locationScope(location.id, locations)) sum += direct.get(inside) ?? 0;
      total.set(location.id, sum);
    }
    return { direct, total };
  }, [items, locations]);

  if (error || catalog.error) return <ErrorNote>{error ?? catalog.error}</ErrorNote>;
  if (loading || catalog.loading) return <PageSkeleton title="Locations" />;

  const origin = window.location.origin;
  const labelFor = (location: Location) => locationLabel(location, locations, origin);
  const describe = (location: Location) => {
    const inside = counts.total.get(location.id) ?? 0;
    return [location.kind, location.code, inside ? plural(inside, 'item') : 'Empty'].filter(Boolean).join(' · ');
  };
  const itemRow = (item: Item) => {
    const type = catalog.typeById.get(item.itemTypeId);
    const colour = type?.fields.find((field) => field.fieldType === 'color');
    const colourValue = colour ? item.fields[colour.key] : null;
    return (
      <Row
        key={item.id}
        to={`/inventory?item=${item.id}`}
        leading={<TypeIcon icon={type?.icon} tone={type?.color} />}
        title={
          <>
            {typeof colourValue === 'string' && colourValue && <Swatch color={colourValue} />}
            {item.name}
          </>
        }
        subtitle={type ? summarizeFields(type.fields, item.fields) : ''}
        trailing={<Figure>{formatQuantity(item.quantity, item.unitId ? catalog.unitById.get(item.unitId) : null)}</Figure>}
      />
    );
  };

  const dialogs = (
    <>
      {form && (
        <LocationForm
          location={form.location}
          parentId={current?.id ?? null}
          locations={locations}
          onClose={() => setForm(null)}
          onSaved={() => setForm(null)}
        />
      )}
      {labels && <LabelPrintDialog labels={labels} onClose={() => setLabels(null)} />}
    </>
  );

  // ---- A location that no longer exists (an old label, or one just deleted elsewhere) ----
  if (id && !current) {
    return (
      <EmptyState icon={MapPinOff} title="This location is not here any more" action={<Link to="/locations"><Button variant="primary">All locations</Button></Link>}>
        It may have been deleted. Anything that was stored in it has no location now.
      </EmptyState>
    );
  }

  // ---- Every location, as a tree ----
  if (!current) {
    // A spool loaded in an AMS (or any machine unit) is put away: the unit is where it is kept.
    const homeless = items.filter((item) => !isPutAway(item));
    const units = (subUnits.data ?? [])
      .filter((unit) => unit.slots.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return (
      <>
        <PageHeader
          title="Locations"
          subtitle={locations.length ? `${plural(locations.length, 'place')} to keep things, ${plural(items.length - homeless.length, 'item')} put away` : 'Where things are kept'}
          actions={
            canEdit && (
              <Button variant="primary" icon={Plus} onClick={() => setForm({})}>
                Add location
              </Button>
            )
          }
        />
        {locations.length === 0 ? (
          <EmptyState icon={MapPin} title="No locations yet">
            Add the rooms, shelves, drawers and bins you keep things in, one inside another. Each gets a QR label: scan it to see what belongs there, or to put things away.
          </EmptyState>
        ) : (
          <div className={styles.sections}>
            <div className={styles.section}>
              <div className={styles.actions}>
                <Button icon={QrCode} onClick={() => setLabels(tree.map(labelFor))}>
                  {locations.length === 1 ? 'Print its label' : `Print all ${locations.length} labels`}
                </Button>
              </div>
              <List>
                {tree.map((location) => (
                  <Row
                    key={location.id}
                    to={`/locations/${location.id}`}
                    leading={
                      <>
                        {location.depth > 0 && <span className={styles.indent} style={{ ['--depth' as string]: location.depth }} aria-hidden />}
                        <MapPin size={18} aria-hidden />
                      </>
                    }
                    title={location.name}
                    subtitle={describe(location)}
                    trailing={<ChevronRight size={18} aria-hidden />}
                  />
                ))}
              </List>
            </div>
            {units.length > 0 && (
              <div className={styles.section}>
                <SectionTitle count={units.length}>In machines</SectionTitle>
                <Muted>Spools loaded in an AMS count as put away. Open one to see what is in it.</Muted>
                <List>
                  {units.map((unit) => {
                    const loaded = unit.slots.filter((slot) => slot.itemId).length;
                    const machine = unit.machineId ? catalog.machineById.get(unit.machineId)?.name : '';
                    return (
                      <Row
                        key={unit.id}
                        to={`/inventory?location=${encodeURIComponent(`${UNIT_PLACE}${unit.id}`)}`}
                        leading={<Printer size={18} aria-hidden />}
                        title={unit.name}
                        subtitle={[machine, `${loaded} of ${plural(unit.slots.length, 'slot')} loaded`].filter(Boolean).join(' · ')}
                        trailing={<ChevronRight size={18} aria-hidden />}
                      />
                    );
                  })}
                </List>
              </div>
            )}
            {homeless.length > 0 && (
              <div className={styles.section}>
                <SectionTitle count={homeless.length}>Not put away</SectionTitle>
                <Muted>These have no location and are not loaded in a machine. Open a location and choose "Move items here" to put them away.</Muted>
                <List>{homeless.slice(0, SHOWN).map(itemRow)}</List>
                {homeless.length > SHOWN && <Muted>And {homeless.length - SHOWN} more.</Muted>}
              </div>
            )}
          </div>
        )}
        {dialogs}
      </>
    );
  }

  // ---- One location ----
  const scope = locationScope(current.id, locations);
  const children = locations.filter((location) => location.parentId === current.id).sort((a, b) => a.name.localeCompare(b.name));
  const here = items.filter((item) => item.locationId === current.id).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const total = counts.total.get(current.id) ?? 0;
  const machines = catalog.machines.filter((machine) => machine.locationId === current.id);
  const trail: Location[] = [];
  for (let cursor: Location | undefined = current; cursor && !trail.includes(cursor); cursor = cursor.parentId ? catalog.locationById.get(cursor.parentId) : undefined) trail.unshift(cursor);

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${current.name}?`,
      message: `${here.length ? `${plural(here.length, 'item')} stored here will have no location. ` : ''}${children.length ? 'Locations inside it move up a level. ' : ''}Labels printed for it stop working.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && (await run(() => api.delete(wsPath(`/locations/${current.id}`)!), 'Location deleted'))) navigate(current.parentId ? `/locations/${current.parentId}` : '/locations', { replace: true });
  };

  const moveHere = async (chosen: Item[]) => {
    const done = await run(
      () => api.post(wsPath('/items/move')!, { itemIds: chosen.map((item) => item.id), locationId: current.id }),
      `Moved ${chosen.length === 1 ? chosen[0].name : plural(chosen.length, 'item')} to ${current.name}`,
    );
    if (done) setMoving(false);
  };

  /** Putting things away one scan at a time: each item label scanned is moved here straight away. */
  const scanHere = async (scan: Scan): Promise<ScanNote> => {
    if (scan.kind === 'location') return { text: scan.id === current.id ? `That is the label for ${current.name} itself. Scan the items to put here.` : 'That is a location label. Scan the items to put here.', tone: 'danger' };
    if (scan.kind !== 'item') return { text: scan.kind === 'text' ? `Nothing here has the code "${scan.text.slice(0, 60)}".` : 'That is a spool tag, not an item label.', tone: 'danger' };
    const item = items.find((candidate) => candidate.id === scan.id);
    if (!item) return { text: 'That label is not for an item in this workspace.', tone: 'danger' };
    if (item.locationId === current.id) return { text: `${item.name} is already here.` };
    await api.post(wsPath('/items/move')!, { itemIds: [item.id], locationId: current.id });
    refreshAll();
    return { text: `Moved ${item.name} here.` };
  };

  return (
    <>
      <nav className={styles.crumbs} aria-label="Where this is">
        <Link to="/locations">Locations</Link>
        {trail.slice(0, -1).map((location) => (
          <span key={location.id}>
            <ChevronRight size={14} aria-hidden /> <Link to={`/locations/${location.id}`}>{location.name}</Link>
          </span>
        ))}
      </nav>
      <PageHeader
        title={current.name}
        subtitle={[current.kind, total ? `${plural(total, 'item')}${total !== here.length ? ` (${here.length} directly here)` : ''}` : 'Nothing stored here yet'].filter(Boolean).join(' · ')}
      />
      {current.code && (
        <p>
          <Muted>Label code </Muted>
          <span className={styles.code}>{current.code}</span>
        </p>
      )}

      <div className={styles.actions}>
        {canOperate && (
          <Button variant="primary" icon={FolderInput} onClick={() => setMoving(true)}>
            Move items here
          </Button>
        )}
        {canOperate && (
          <Button icon={ScanLine} onClick={() => setScanning(true)}>
            Scan items here
          </Button>
        )}
        <Button icon={QrCode} onClick={() => setLabels([labelFor(current)])}>
          Print label
        </Button>
        {scope.size > 1 && (
          <Button icon={QrCode} onClick={() => setLabels(tree.filter((location) => scope.has(location.id)).map(labelFor))}>
            Print all {scope.size} labels here
          </Button>
        )}
        {canEdit && (
          <>
            <Button icon={Plus} onClick={() => setForm({})}>
              Add a location inside
            </Button>
            <Button icon={Pencil} onClick={() => setForm({ location: current })}>
              Edit
            </Button>
            <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
              Delete
            </Button>
          </>
        )}
      </div>

      <div className={styles.sections}>
        {children.length > 0 && (
          <div className={styles.section}>
            <SectionTitle count={children.length}>Inside {current.name}</SectionTitle>
            <List>
              {children.map((location) => (
                <Row key={location.id} to={`/locations/${location.id}`} leading={<MapPin size={18} aria-hidden />} title={location.name} subtitle={describe(location)} trailing={<ChevronRight size={18} aria-hidden />} />
              ))}
            </List>
          </div>
        )}

        <div className={styles.section}>
          <SectionTitle count={here.length}>Stored here</SectionTitle>
          {here.length === 0 ? (
            <Muted>{children.length ? 'Nothing is kept directly here; look in the locations inside it.' : 'Nothing is kept here yet.'}</Muted>
          ) : (
            <List>{here.slice(0, SHOWN).map(itemRow)}</List>
          )}
          {total > Math.min(here.length, SHOWN) && (
            <Link to={`/inventory?location=${current.id}`}>
              See all {plural(total, 'item')} in {current.name}
              {total !== here.length ? ' and inside it' : ''} in the inventory
            </Link>
          )}
        </div>

        {machines.length > 0 && (
          <div className={styles.section}>
            <SectionTitle count={machines.length}>Machines here</SectionTitle>
            <List>
              {machines.map((machine) => (
                <Row key={machine.id} to="/machines" title={machine.name} subtitle={[machine.manufacturer, machine.model].filter(Boolean).join(' ')} />
              ))}
            </List>
          </div>
        )}
      </div>

      {scanning && <ScanDialog title={`Put away in ${current.name}`} hint="Scan each item's label. It is moved here as soon as it reads." onClose={() => setScanning(false)} onScan={scanHere} />}
      {moving && (
        <ItemPicker
          title={`Move items to ${current.name}`}
          items={items.filter((item) => item.locationId !== current.id)}
          catalog={catalog}
          onPick={() => undefined}
          onClose={() => setMoving(false)}
          note={(item) => (item.locationId ? `Now in ${locationPath(item.locationId, locations)}` : item.slot ? `Loaded in ${item.slot.subUnit.name}` : 'Not put away')}
          multi={{ confirmLabel: (count) => (count ? `Move ${plural(count, 'item')} here` : 'Move here'), onConfirm: moveHere, busy }}
        />
      )}
      {dialogs}
    </>
  );
}
