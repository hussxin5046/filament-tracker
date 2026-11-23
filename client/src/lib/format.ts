import type { CustomField, FieldValue, Item, Location, Unit } from '@/lib/types';

const DAY_MS = 86_400_000;

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(value);
}

export function formatQuantity(value: number, unit?: Unit | null): string {
  const text = formatNumber(value, unit?.decimals ?? 2);
  return unit ? `${text} ${unit.symbol}` : text;
}

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatHours(hours: number): string {
  return `${formatNumber(hours, 1)} h`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "in 3 days", "5 days ago", "today". */
export function relativeDays(days: number): string {
  const whole = Math.round(days);
  if (whole === 0) return 'today';
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  return formatter.format(whole, 'day');
}

export function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / DAY_MS;
}

export function toDateInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Parse what someone typed into a numeric box. Accepts a decimal comma. Empty or invalid gives null. */
export function parseNumber(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** "840 KB", "12.4 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

export const isLow =(item: Pick<Item, 'quantity' | 'minQuantity'>) => item.quantity < item.minQuantity;

export const isWorn = (item: Pick<Item, 'wearFlag' | 'usageHours' | 'lifeHours'>) =>
  item.wearFlag || (item.lifeHours !== null && item.usageHours >= item.lifeHours);

export function formatFieldValue(field: CustomField, value: FieldValue | undefined): string {
  if (value === undefined || value === null || value === '') return '';
  if (field.fieldType === 'boolean') return value ? field.label : '';
  if (field.fieldType === 'date') return formatDate(String(value));
  if (field.fieldType === 'number') return `${formatNumber(Number(value), 3)}${field.unit ? ` ${field.unit}` : ''}`;
  return String(value);
}

/** One-line description of an item built from the fields its type marks as "show in list". */
export function summarizeFields(fields: CustomField[], values: Record<string, FieldValue>): string {
  return fields
    .filter((f) => f.showInList && f.fieldType !== 'color')
    .map((f) => {
      const text = formatFieldValue(f, values[f.key]);
      if (!text || f.fieldType !== 'number' || f.unit) return text;
      // Unit-less counts read better with their label: "2 flutes", and "1 flute" rather than "1 flutes".
      const label = f.label.toLowerCase();
      return `${text} ${values[f.key] === 1 && label.endsWith('s') ? label.slice(0, -1) : label}`;
    })
    .filter(Boolean)
    .join(' · ');
}

/** "Workshop › Filament rack › Dry box A" */
export function locationPath(locationId: string | null, locations: Location[]): string {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let cursor = locationId ? byId.get(locationId) : undefined; cursor && !seen.has(cursor.id); cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) {
    seen.add(cursor.id);
    parts.unshift(cursor.name);
  }
  return parts.join(' › ');
}

/** Prefix for a machine unit (an AMS) used where a location id is expected, such as the inventory's Location filter. */
export const UNIT_PLACE = 'unit:';

/** Is the item kept somewhere: on a location, or loaded in a machine unit such as an AMS? */
export function isPutAway(item: Pick<Item, 'locationId' | 'slot'>): boolean {
  return Boolean(item.locationId || item.slot);
}

/** "AMS 1 · slot 2" for a loaded item, else its location path. Empty when it is in neither. */
export function itemPlace(item: Pick<Item, 'locationId' | 'slot'>, locations: Location[]): string {
  return item.slot ? `${item.slot.subUnit.name} · slot ${item.slot.position}` : locationPath(item.locationId, locations);
}

/** A location and everything nested inside it, at any depth. */
export function locationScope(locationId: string, locations: Location[]): Set<string> {
  const scope = new Set([locationId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const location of locations) {
      if (location.parentId && scope.has(location.parentId) && !scope.has(location.id)) {
        scope.add(location.id);
        grew = true;
      }
    }
  }
  return scope;
}

/** Locations in tree order with their depth, for indented pickers and lists. */
export function flattenLocations(locations: Location[]): Array<Location & { depth: number }> {
  const children = new Map<string | null, Location[]>();
  const ids = new Set(locations.map((l) => l.id));
  for (const location of locations) {
    const parent = location.parentId && ids.has(location.parentId) ? location.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), location]);
  }
  const result: Array<Location & { depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const location of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      result.push({ ...location, depth });
      walk(location.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

/**
 * Will a piece of size `needed` fit inside a piece of size `available`, in any orientation?
 * Sorting both largest-first and comparing pairwise is exact for axis-aligned rectangles and boxes.
 */
export function fits(needed: number[], available: number[]): boolean {
  const need = needed.filter((n) => n > 0).sort((a, b) => b - a);
  const have = [...available].sort((a, b) => b - a);
  return need.every((n, index) => have[index] !== undefined && have[index] >= n);
}
