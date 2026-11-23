import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { StockMeter } from '@/components/items/StockMeter';
import { Badge, Figure, Swatch, TypeIcon } from '@/components/ui/Display';
import type { Catalog } from '@/hooks/useCatalog';
import { flattenLocations, formatQuantity, isLow, isWorn, locationPath, summarizeFields } from '@/lib/format';
import type { Item } from '@/lib/types';
import styles from '@/components/items/ItemBoard.module.css';

export type BoardGrouping = 'category' | 'machine' | 'location';

interface Section {
  id: string;
  label: string;
  items: Item[];
}

interface Column {
  id: string;
  title: string;
  hint: string;
  icon: string;
  tone: string | null;
  count: number;
  sections: Section[];
  /** Values a new item gets when added from this column. Null for catch-all columns. */
  preset: Partial<Item> | null;
  /** Catch-all and container columns ("Any machine", "No location", a room) only appear when they hold something. */
  fallback: boolean;
}

/** Splits a column's items by category, in the workspace's own category order. */
function byCategory(items: Item[], catalog: Catalog): Section[] {
  const sections = catalog.types
    .map((type) => ({ id: type.id, label: type.name, items: items.filter((item) => item.itemTypeId === type.id) }))
    .filter((section) => section.items.length > 0);
  const known = new Set(catalog.types.map((type) => type.id));
  const other = items.filter((item) => !known.has(item.itemTypeId));
  return other.length ? [...sections, { id: 'other', label: 'Other', items: other }] : sections;
}

function buildColumns(grouping: BoardGrouping, items: Item[], catalog: Catalog, onlyMachineId?: string): Column[] {
  if (grouping === 'category') {
    return catalog.types.map((type) => {
      const own = items.filter((item) => item.itemTypeId === type.id);
      return {
        id: type.id, title: type.name, hint: '', icon: type.icon, tone: type.color, count: own.length,
        sections: [{ id: type.id, label: '', items: own }], preset: { itemTypeId: type.id }, fallback: false,
      };
    });
  }

  if (grouping === 'machine') {
    const placed = new Set<string>();
    // With one machine in focus, parts shared with other machines do not drag those machines' columns in.
    const columns: Column[] = catalog.machines.filter((machine) => !onlyMachineId || machine.id === onlyMachineId).map((machine) => {
      const loaded = items.filter((item) => item.slot?.subUnit.machineId === machine.id);
      const loadedIds = new Set(loaded.map((item) => item.id));
      const fitting = items.filter((item) => !loadedIds.has(item.id) && item.compatibleMachineIds.includes(machine.id));
      for (const item of [...loaded, ...fitting]) placed.add(item.id);
      const machineType = machine.machineTypeId ? catalog.machineTypeById.get(machine.machineTypeId) : undefined;
      return {
        id: machine.id, title: machine.name, hint: machineType?.name ?? '', icon: machineType?.icon || 'Cog', tone: 'blue',
        count: loaded.length + fitting.length,
        sections: [...(loaded.length ? [{ id: 'loaded', label: 'Loaded now', items: loaded }] : []), ...byCategory(fitting, catalog)],
        preset: { compatibleMachineIds: [machine.id] }, fallback: false,
      };
    });
    const rest = items.filter((item) => !placed.has(item.id));
    columns.push({
      id: 'none', title: 'Any machine', hint: 'Not tied to one machine', icon: 'Boxes', tone: 'slate', count: rest.length,
      sections: byCategory(rest, catalog), preset: null, fallback: true,
    });
    return columns;
  }

  // Location: one column per place things are actually kept, in tree order.
  // A location that only contains other locations (a room, a rack) shows up only if something sits in it directly.
  // A spool loaded in a machine unit (an AMS) sits in that unit's column, not on the shelf it came from.
  const parents = new Set(catalog.locations.map((location) => location.parentId).filter(Boolean));
  const shelved = items.filter((item) => !item.slot);
  const columns: Column[] = flattenLocations(catalog.locations).map((location) => {
    const own = shelved.filter((item) => item.locationId === location.id);
    return {
      id: location.id, title: location.name, hint: locationPath(location.parentId, catalog.locations), icon: 'Warehouse', tone: 'teal',
      count: own.length, sections: byCategory(own, catalog), preset: { locationId: location.id }, fallback: parents.has(location.id),
    };
  });
  const units = new Map<string, { name: string; machineId: string | null; items: Item[] }>();
  for (const item of items) {
    if (!item.slot) continue;
    const { id, name, machineId } = item.slot.subUnit;
    const unit = units.get(id) ?? { name, machineId, items: [] };
    unit.items.push(item);
    units.set(id, unit);
  }
  for (const [id, unit] of [...units].sort(([, a], [, b]) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    columns.push({
      id: `unit-${id}`, title: unit.name, hint: (unit.machineId && catalog.machineById.get(unit.machineId)?.name) || 'Loaded', icon: 'Printer', tone: 'blue',
      count: unit.items.length, sections: byCategory(unit.items, catalog), preset: null, fallback: true,
    });
  }
  const rest = shelved.filter((item) => !item.locationId || !catalog.locationById.has(item.locationId));
  columns.push({
    id: 'none', title: 'No location', hint: 'Not put away yet', icon: 'Package', tone: 'slate', count: rest.length,
    sections: byCategory(rest, catalog), preset: null, fallback: true,
  });
  return columns;
}

interface ItemBoardProps {
  items: Item[];
  catalog: Catalog;
  grouping: BoardGrouping;
  /** Drop columns with nothing in them, for when a search or filter is narrowing the board. */
  hideEmpty: boolean;
  canEdit: boolean;
  /** The machine in focus, if any: the machine board then shows that machine alone. */
  focusMachineId?: string;
  onOpen: (itemId: string) => void;
  onAdd: (preset: Partial<Item>) => void;
}

/** Inventory as a board: one column per category, machine or location, each holding its own cards. */
export function ItemBoard({ items, catalog, grouping, hideEmpty, canEdit, focusMachineId, onOpen, onAdd }: ItemBoardProps) {
  const columns = useMemo(
    () => buildColumns(grouping, items, catalog, focusMachineId).filter((column) => column.count > 0 || (!hideEmpty && !column.fallback)),
    [grouping, items, catalog, hideEmpty, focusMachineId],
  );

  return (
    <div className={styles.board} role="list" aria-label={`Inventory by ${grouping}`}>
      {columns.map((column) => (
        <section key={column.id} className={styles.column} role="listitem" aria-label={column.title}>
          <header className={styles.columnHead}>
            <TypeIcon icon={column.icon} tone={column.tone} size="sm" />
            <div className={styles.columnHeading}>
              <h2 className={styles.columnTitle}>{column.title}</h2>
              {column.hint && <span className={styles.columnHint}>{column.hint}</span>}
            </div>
            <span className={styles.columnCount}>{column.count}</span>
            {canEdit && column.preset && (
              <IconButton icon={Plus} size="sm" label={`Add item to ${column.title}`} onClick={() => onAdd(column.preset ?? {})} />
            )}
          </header>

          <div className={styles.columnBody}>
            {column.count === 0 && <p className={styles.columnEmpty}>Nothing here yet</p>}
            {column.sections.map((section) => (
              <div key={section.id} className={styles.section}>
                {section.label && (
                  <h3 className={styles.sectionLabel}>
                    {section.label}
                    <span className={styles.sectionCount}>{section.items.length}</span>
                  </h3>
                )}
                {section.items.map((item) => (
                  <BoardCard key={item.id} item={item} catalog={catalog} onOpen={onOpen} />
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BoardCard({ item, catalog, onOpen }: { item: Item; catalog: Catalog; onOpen: (itemId: string) => void }) {
  const itemType = catalog.typeById.get(item.itemTypeId);
  const unit = item.unitId ? catalog.unitById.get(item.unitId) : null;
  const colour = itemType?.fields.find((f) => f.fieldType === 'color');
  const colourValue = colour ? item.fields[colour.key] : null;
  const low = isLow(item);
  const worn = isWorn(item);
  const place = item.slot ? `${item.slot.subUnit.name} · slot ${item.slot.position}` : (catalog.locationById.get(item.locationId ?? '')?.name ?? '');
  const summary = itemType ? summarizeFields(itemType.fields, item.fields) : '';

  return (
    <button type="button" className={`${styles.card} ${low || worn ? styles.cardFlagged : ''}`} onClick={() => onOpen(item.id)}>
      <span className={styles.cardTitle}>
        {typeof colourValue === 'string' && colourValue && <Swatch color={colourValue} />}
        <span className={styles.cardName}>{item.name}</span>
      </span>
      {summary && <span className={styles.cardLine}>{summary}</span>}
      {place && <span className={styles.cardLine}>{place}</span>}
      <span className={styles.cardFoot}>
        <Figure>{formatQuantity(item.quantity, unit)}</Figure>
        {worn ? (
          <Badge tone="danger">Worn</Badge>
        ) : item.isRemnant && !low ? (
          <Badge>Offcut</Badge>
        ) : item.capacity || item.minQuantity > 0 ? (
          <span className={styles.cardGauge}>
            <StockMeter item={item} compact />
          </span>
        ) : null}
      </span>
    </button>
  );
}
