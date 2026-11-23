import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Minus, Nfc, PackageOpen, Pencil, PlugZap, Plus, QrCode, Scissors, Trash2 } from 'lucide-react';
import { StockMeter } from '@/components/items/StockMeter';
import { LabelPrintDialog } from '@/components/labels/LabelPrintDialog';
import { useScanHandler, useScanner } from '@/components/scan/ScannerProvider';
import { LoadIntoDialog } from '@/components/tags/LoadIntoDialog';
import { TagDialog } from '@/components/tags/TagDialog';
import { Button } from '@/components/ui/Button';
import { Badge, Figure, Loading, Meter, Muted, SectionTitle, Swatch, TypeIcon } from '@/components/ui/Display';
import { NumberField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useAction, useOptimisticAction } from '@/components/ui/Toast';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useItems, type Catalog } from '@/hooks/useCatalog';
import { useItemDelete, useStockChange } from '@/hooks/useUndo';
import { api } from '@/lib/api';
import { itemLabel } from '@/lib/labels';
import { formatDateTime, formatFieldValue, formatHours, formatNumber, formatQuantity, isLow, isWorn, locationPath, parseNumber } from '@/lib/format';
import { isStickerTag, spoolFacts } from '@/lib/spoolMatch';
import { MOVEMENT_REASON } from '@/lib/status';
import { patchCached } from '@/lib/store';
import type { FindAnswer, Item, Movement, Unit } from '@/lib/types';
import styles from '@/components/items/Items.module.css';

interface Props {
  item: Item;
  catalog: Catalog;
  onClose: () => void;
  onEdit: () => void;
  onAddOffcut: () => void;
  /** Opened by scanning the item: start in the exact-amount field, ready for what the scale says. */
  focusAmount?: boolean;
}

/** Step sizes that suit the scale of the item: grams move in tens, screws in ones. */
export function stepsFor(item: Item, unit: Unit | undefined): number[] {
  const scale = Math.max(item.capacity ?? 0, item.quantity, item.minQuantity);
  if (unit && unit.decimals > 0 && scale < 20) return [0.1, 1];
  if (scale >= 400) return [10, 50, 100];
  if (scale >= 40) return [1, 10];
  return [1, 5];
}

const names = (displays: FindAnswer['displays']) => displays.map((display) => display.name).join(' and ');

/** What a find came back with, in a sentence. `left` is the seconds the display stays lit. */
function describeFind(found: FindAnswer, left: number): string {
  const where = found.place ? ` It is in ${found.place}.` : '';
  switch (found.state) {
    case 'lit': {
      const showing = found.displays.filter((display) => display.online && !display.outdated);
      if (!showing.length) return `${names(found.displays)} needs a firmware update before it can light up.${where}`;
      return `Lit up on ${names(showing)} for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.${where}`;
    }
    case 'offline':
      return `${names(found.displays)} is not connected, so it cannot light up.${where}`;
    case 'no-display':
      return `No display shows where it is kept.${where}`;
    case 'loaded':
      return `It is loaded in ${found.place}.`;
    case 'on-the-move':
      return 'It is on the move: someone took it out.';
    default:
      return 'It has no location.';
  }
}

export function ItemSheet({ item, catalog, onClose, onEdit, onAddOffcut, focusAmount }: Props) {
  const { wsPath, canEdit, canOperate, money } = useWorkspace();
  const runNow = useOptimisticAction();
  const stock = useStockChange();
  const deleteItem = useItemDelete();
  const busy = stock.busy;
  const { data: movements } = useWsQuery<Movement[]>(`/items/${item.id}/movements`);
  const [exact, setExact] = useState('');
  const [labelling, setLabelling] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [loading, setLoading] = useState(false);
  const { items } = useItems();
  // Looking for it: the display nearest to where it is kept lights its row, and this says where that is.
  const { run, busy: asking } = useAction();
  const [found, setFound] = useState<FindAnswer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const kept = item.locationId !== null && !item.slot;
  const findPath = wsPath(`/items/${item.id}/find`)!;
  const find = () =>
    run(async () => {
      setFound(await api.post<FindAnswer>(findPath));
      setNow(Date.now());
    });
  const stopFinding = () => {
    setFound(null);
    return run(() => api.delete(findPath));
  };
  const takeOut = async () => {
    if (await run(() => api.post(wsPath(`/items/${item.id}/take-out`)!), 'On the move. Press Load into… at the printer.')) setFound(null);
  };
  // A scan can swap the sheet to another item: what was said about the last one does not apply.
  useEffect(() => setFound(null), [item.id]);
  const lighting = found?.expiresAt ?? null;
  useEffect(() => {
    if (lighting === null) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [lighting]);
  // The display stops by itself after two minutes, and when the item leaves its place (taken out at the display, say).
  useEffect(() => {
    if (found && ((lighting !== null && now >= lighting) || (!kept && (lighting !== null || found.state === 'no-display')))) setFound(null);
  }, [found, lighting, now, kept]);
  // Scanning the next item while this one is open goes straight to it, unless a dialog of this sheet is in the way.
  const scanner = useScanner();
  useScanHandler(labelling || tagging || loading ? null : scanner.openRaw);
  const exactForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (focusAmount) exactForm.current?.querySelector('input')?.focus();
  }, [focusAmount]);
  // Tags and feeder slots are for filament: anything with a material.
  const isSpool = Boolean(spoolFacts(item, catalog).material);

  const type = catalog.typeById.get(item.itemTypeId);
  const unit = item.unitId ? catalog.unitById.get(item.unitId) : undefined;
  const supplier = item.supplierId ? catalog.supplierById.get(item.supplierId) : undefined;
  const colour = type?.fields.find((f) => f.fieldType === 'color');
  const colourValue = colour ? item.fields[colour.key] : null;
  const low = isLow(item);
  const worn = isWorn(item);
  const hasSize = type?.fields.some((f) => f.isSizeDimension) ?? false;

  const adjust = (delta: number) => stock.change(item.id, { mode: 'delta', value: delta }, `${delta < 0 ? 'Used' : 'Added'} ${formatQuantity(Math.abs(delta), unit)}`);
  const setTo = async () => {
    const value = parseNumber(exact);
    if (value === null || value < 0) return;
    if (await stock.change(item.id, { mode: 'set', value, note: 'Counted / weighed' }, 'Stock level set')) setExact('');
  };
  // No "are you sure": the item goes at once and the toast offers Undo.
  const remove = () => {
    onClose();
    deleteItem(item);
  };
  // A flag, not a stock level: it shows at once and goes back if the save fails.
  const toggleWear = () => {
    const wearFlag = !item.wearFlag;
    return runNow(
      () => patchCached<Item[]>(wsPath('/items')!, (all) => all.map((other) => (other.id === item.id ? { ...other, wearFlag } : other))),
      () => api.patch(wsPath(`/items/${item.id}`)!, { wearFlag }),
    );
  };

  const details: Array<[string, string]> = [
    ...(type?.fields ?? []).filter((f) => f.fieldType !== 'color').map((f): [string, string] => [f.label, formatFieldValue(f, item.fields[f.key])]),
    ['Location', item.outSince && !item.slot ? `On the move since ${formatDateTime(item.outSince)}` : locationPath(item.locationId, catalog.locations)],
    ['Loaded in', item.slot ? `${item.slot.subUnit.name}, slot ${item.slot.position}` : ''],
    ['Tag', item.tagId ? (isStickerTag(item.tagId) ? 'NFC sticker' : 'Its own tag, read by the printer') : ''],
    ['Supplier', supplier?.name ?? ''],
    ['Cost', item.unitCost ? `${money(item.unitCost * (item.capacity ?? 1))} per ${formatQuantity(item.capacity ?? 1, unit)}` : ''],
    ['Value in stock', item.unitCost ? money(item.unitCost * item.quantity) : ''],
    ['Fits', item.compatibleMachineIds.map((id) => catalog.machineById.get(id)?.name).filter(Boolean).join(', ')],
    ['SKU', item.sku],
    ['Notes', item.notes],
  ];

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <>
          {canEdit && (
            <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
              Delete
            </Button>
          )}
          <Button icon={QrCode} onClick={() => setLabelling(true)}>
            Print label
          </Button>
          {canOperate && (
            <Button icon={LocateFixed} onClick={() => void find()} disabled={asking}>
              Find
            </Button>
          )}
          {kept && canOperate && (
            <Button icon={PackageOpen} onClick={() => void takeOut()} disabled={asking}>
              Take out
            </Button>
          )}
          {isSpool && canOperate && (
            <>
              <Button icon={Nfc} onClick={() => setTagging(true)}>
                Spool tag
              </Button>
              <Button icon={PlugZap} onClick={() => setLoading(true)}>
                Load into…
              </Button>
            </>
          )}
          {canEdit && hasSize && !item.isRemnant && (
            <Button icon={Scissors} onClick={onAddOffcut}>
              Add offcut
            </Button>
          )}
          {canEdit && (
            <Button icon={Pencil} onClick={onEdit}>
              Edit
            </Button>
          )}
        </>
      }
    >
      <div className={styles.sheetHead}>
        <TypeIcon icon={type?.icon} tone={type?.color} size="lg" toned />
        <div className={styles.sheetHeadText}>
          <span className={styles.sheetType}>
            {type?.name}
            {typeof colourValue === 'string' && colourValue && <Swatch color={colourValue} label={`Colour ${colourValue}`} />}
          </span>
          <div className={styles.badges}>
            {low && <Badge tone="danger">Low stock</Badge>}
            {worn && <Badge tone="danger">Worn</Badge>}
            {item.isRemnant && <Badge tone="info">Offcut</Badge>}
            {item.slot && <Badge tone="accent">{item.slot.subUnit.name}</Badge>}
            {item.outSince && !item.slot && <Badge tone="info">On the move</Badge>}
          </div>
        </div>
      </div>

      {found && (
        <div className={styles.find} role="status">
          <LocateFixed size={20} aria-hidden />
          <span className={styles.findText}>{describeFind(found, lighting === null ? 0 : Math.max(0, Math.ceil((lighting - now) / 1000)))}</span>
          {lighting !== null && (
            <Button size="sm" onClick={() => void stopFinding()} disabled={asking}>
              Stop
            </Button>
          )}
        </div>
      )}

      <div className={styles.stock}>
        <div className={styles.stockFigure}>
          <span className={`${styles.stockValue} ${low ? styles.stockLow : ''}`}>{formatNumber(item.quantity, unit?.decimals ?? 2)}</span>
          <span className={styles.stockUnit}>{unit?.symbol}</span>
        </div>
        <StockMeter item={item} />
        <Muted>
          {item.capacity ? `of ${formatQuantity(item.capacity, unit)}` : ''}
          {item.capacity && item.minQuantity > 0 ? ' · ' : ''}
          {item.minQuantity > 0 ? `minimum ${formatQuantity(item.minQuantity, unit)}` : ''}
        </Muted>

        {canOperate && (
          <>
            <div className={styles.steps}>
              {stepsFor(item, unit)
                .slice()
                .reverse()
                .map((step) => (
                  <Button key={`minus-${step}`} size="lg" icon={Minus} disabled={busy || item.quantity <= 0} onClick={() => adjust(-step)} aria-label={`Use ${step} ${unit?.symbol ?? ''}`}>
                    {formatNumber(step, 1)}
                  </Button>
                ))}
              {canEdit && stepsFor(item, unit).map((step) => (
                <Button key={`plus-${step}`} size="lg" icon={Plus} disabled={busy} onClick={() => adjust(step)} aria-label={`Add ${step} ${unit?.symbol ?? ''}`}>
                  {formatNumber(step, 1)}
                </Button>
              ))}
            </div>
            <form
              ref={exactForm}
              className={styles.exact}
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
              <Button type="submit" variant="primary" disabled={busy || parseNumber(exact) === null}>
                Set
              </Button>
            </form>
          </>
        )}
      </div>

      {type?.tracksLife && (
        <div className={styles.life}>
          <SectionTitle
            action={
              canEdit && (
                <Button size="sm" onClick={toggleWear} disabled={busy}>
                  {item.wearFlag ? 'Clear worn flag' : 'Flag as worn'}
                </Button>
              )
            }
          >
            Tool life
          </SectionTitle>
          {item.lifeHours ? <Meter value={item.usageHours} max={item.lifeHours} threshold={item.lifeHours * 0.8} tone={worn ? 'danger' : item.usageHours >= item.lifeHours * 0.8 ? 'warn' : 'accent'} label="Tool life used" /> : null}
          <Figure tone={worn ? 'danger' : undefined}>
            {formatHours(item.usageHours)} used{item.lifeHours ? ` of ${formatHours(item.lifeHours)}` : ''}
          </Figure>
        </div>
      )}

      <dl className={styles.facts}>
        {details
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className={styles.fact}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <div>
        <SectionTitle>History</SectionTitle>
        {!movements ? (
          <Loading />
        ) : movements.length === 0 ? (
          <Muted>No stock changes recorded yet.</Muted>
        ) : (
          <ul className={styles.history}>
            {movements.slice(0, 12).map((move) => (
              <li key={move.id} className={styles.move}>
                <Figure tone={move.delta < 0 ? 'neutral' : 'ok'}>
                  {move.delta > 0 ? '+' : ''}
                  {formatNumber(move.delta, unit?.decimals ?? 2)}
                </Figure>
                <span className={styles.moveText}>
                  {MOVEMENT_REASON[move.reason] ?? move.reason}
                  {move.job ? `: ${move.job.name}` : move.note ? `: ${move.note}` : ''}
                </span>
                <Muted>
                  {formatDateTime(move.createdAt)}
                  {move.user ? ` · ${move.user.name}` : ''}
                </Muted>
              </li>
            ))}
          </ul>
        )}
      </div>
      {labelling && <LabelPrintDialog labels={[itemLabel(item, catalog, window.location.origin)]} onClose={() => setLabelling(false)} />}
      {tagging && <TagDialog item={item} items={items} catalog={catalog} onClose={() => setTagging(false)} />}
      {loading && <LoadIntoDialog item={item} items={items} catalog={catalog} onClose={() => setLoading(false)} />}
    </Modal>
  );
}
