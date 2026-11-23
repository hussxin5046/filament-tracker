/**
 * Handheld mode: a lighter Wrkbench for a mobile computer with a scanner built in (a Zebra TC56, for one).
 * Only scanning, items and locations; no camera, which stops the built-in scanner from firing. A device that
 * opens it keeps opening it, until someone chooses the full Wrkbench again.
 */
import { findAllByCode, parseScan } from '@/lib/scan';
import type { Item, Location } from '@/lib/types';

const KEY = 'wrkbench.handheld';

export function handheldRemembered(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function rememberHandheld(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, 'on');
    else localStorage.removeItem(KEY);
  } catch {
    // Not remembered: the device opens the full Wrkbench next time.
  }
}

export const handheldItemPath = (id: string) => `/handheld/item/${encodeURIComponent(id)}`;
export const handheldLocationPath = (id: string) => `/handheld/location/${encodeURIComponent(id)}`;

export type HandheldScan =
  | { kind: 'item'; item: Item }
  | { kind: 'location'; location: Location }
  /** A maker's barcode that several items share. */
  | { kind: 'several'; text: string; items: Item[] }
  | { kind: 'problem'; message: string };

/** What a scan in handheld mode is, among this workspace's items and locations. */
export function readHandheldScan(raw: string, items: Item[], locations: Location[]): HandheldScan {
  const scan = parseScan(raw);
  if (scan.kind === 'openspool') return { kind: 'problem', message: 'That is a spool tag. Read spool tags in the full Wrkbench.' };
  if (scan.kind === 'item') {
    const item = items.find((candidate) => candidate.id === scan.id);
    return item ? { kind: 'item', item } : { kind: 'problem', message: 'That label is not for an item in this workspace.' };
  }
  if (scan.kind === 'location') {
    const location = locations.find((candidate) => candidate.id === scan.id);
    return location ? { kind: 'location', location } : { kind: 'problem', message: 'That label is not for a location in this workspace.' };
  }
  const matches = findAllByCode(scan.text, items, locations);
  if (matches.length === 0) return { kind: 'problem', message: `Nothing here has the code "${scan.text.slice(0, 60)}".` };
  if (matches.length > 1) {
    const ids = new Set(matches.map((match) => match.id));
    return { kind: 'several', text: scan.text, items: items.filter((item) => ids.has(item.id)) };
  }
  const [found] = matches;
  if (found.kind === 'location') {
    const location = locations.find((candidate) => candidate.id === found.id);
    if (location) return { kind: 'location', location };
  } else {
    const item = items.find((candidate) => candidate.id === found.id);
    if (item) return { kind: 'item', item };
  }
  return { kind: 'problem', message: `Nothing here has the code "${scan.text.slice(0, 60)}".` };
}
