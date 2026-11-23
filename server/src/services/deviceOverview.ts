import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { PrinterState } from '@/integrations/types';
import type { Db } from '@/db';
import { isLow } from '@/services/reorder';
import { round } from '@/services/stock';

/**
 * What a location display draws: the items stored in one location (and the locations inside it), already
 * worded and formatted so the firmware only has to lay them out. Kept small (a few KB) because the display
 * has no spare memory, and versioned so an unchanged poll costs one short 304.
 */

/**
 * Seconds between a display's polls. Sent with every overview so it can be changed here without new firmware.
 * Short enough that a spool someone is looking for lights up while they walk over.
 */
export const POLL_SECONDS = 10;
/** A display's last-seen time is written at most once a minute, so 2.5 minutes without one means it is off. */
export const ONLINE_MS = 150_000;

export const displayOnline = (lastSeenAt: Date | null) => lastSeenAt !== null && Date.now() - lastSeenAt.getTime() < ONLINE_MS;
/** More than this many rows would not fit the display's memory; `total` still gives the real count. */
export const MAX_ROWS = 40;
const MAX_LOCATIONS = 60;

/**
 * The display's built-in fonts hold plain ASCII only. Accents are dropped ("Café" → "Cafe") and anything else
 * becomes a space, so names read sensibly instead of showing boxes.
 */
export function forDisplay(value: string, max = 40): string {
  const plain = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}~` : plain;
}

interface LocationRow {
  id: string;
  name: string;
  parentId: string | null;
}

/** Every location in the workspace, with a way to read one's path and the locations below it. */
export async function locationTree(db: Db, workspaceId: string) {
  const rows: LocationRow[] = await db.location.findMany({ where: { workspaceId }, select: { id: true, name: true, parentId: true } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string, string[]>();
  for (const row of rows) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);

  const path = (id: string): string => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let at = byId.get(id); at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
      seen.add(at.id);
      names.unshift(at.name);
    }
    return names.join(' / ');
  };
  /** The location and everything inside it, at any depth. */
  const subtree = (id: string): string[] => {
    const out: string[] = [];
    const queue = [id];
    while (queue.length) {
      const next = queue.shift()!;
      if (out.includes(next)) continue;
      out.push(next);
      queue.push(...(children.get(next) ?? []));
    }
    return out;
  };
  return { byId, path, subtree };
}

export const itemSelect = {
  id: true, name: true, quantity: true, capacity: true, minQuantity: true, fields: true, tagId: true, locationId: true, outSince: true,
  unit: { select: { symbol: true, decimals: true } },
  supplier: { select: { name: true } },
  itemType: { select: { name: true, fields: { select: { key: true, label: true, fieldType: true } } } },
} as const;

type ItemRow = Prisma.ItemGetPayload<{ select: typeof itemSelect }>;

export interface DisplayRow {
  id: string;
  name: string;
  /** "PLA - Bambu Lab", or the item's type when it has neither. */
  sub: string;
  color: string | null;
  qty: string;
  fill: number | null;
  low: boolean;
  /** The sub-location it sits in, when that is not the location being shown. */
  at: string | null;
  tagged: boolean;
}

/** One item as a display row. `shownLocationId` is the location on screen, so items deeper down get an "at". */
export function displayRow(item: ItemRow, shownLocationId: string | null, locationName: (id: string) => string): DisplayRow {
  const values = (item.fields ?? {}) as Record<string, unknown>;
  const fields = item.itemType.fields;
  const text = (key: string | undefined) => {
    const value = key ? values[key] : undefined;
    return typeof value === 'string' ? value.trim() : '';
  };
  const material = text((fields.find((f) => f.key === 'material') ?? fields.find((f) => /material/i.test(f.label)))?.key);
  const brand = text(fields.find((f) => f.key === 'brand')?.key) || item.supplier?.name || '';
  const colour = text(fields.find((f) => f.fieldType === 'color')?.key);
  const decimals = item.unit?.decimals ?? 0;
  const amount = round(item.quantity, decimals).toFixed(decimals);
  return {
    id: item.id,
    name: forDisplay(item.name),
    sub: forDisplay([material, brand].filter(Boolean).join(' - ') || item.itemType.name),
    color: /^#[0-9a-f]{6}$/i.test(colour) ? colour.toLowerCase() : null,
    qty: forDisplay(item.unit?.symbol ? `${amount} ${item.unit.symbol}` : amount, 16),
    fill: item.capacity && item.capacity > 0 ? round(Math.min(1, Math.max(0, item.quantity / item.capacity)), 2) : null,
    low: isLow(item),
    at: item.locationId && item.locationId !== shownLocationId ? forDisplay(locationName(item.locationId), 24) : null,
    tagged: Boolean(item.tagId),
  };
}

/** Low stock first, then by name: what needs attention is at the top of a small screen. */
const byAttention = (a: DisplayRow, b: DisplayRow) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name);

/** New firmware the display should fetch from /api/device/firmware and install. */
export interface DisplayUpdate {
  version: string;
  size: number;
  md5: string;
}

export interface Overview {
  v: string;
  poll: number;
  workspace: string;
  device: string;
  canWrite: boolean;
  location: { id: string; name: string; path: string } | null;
  total: number;
  lowCount: number;
  items: DisplayRow[];
  locations: Array<{ id: string; name: string }>;
  printer: DisplayPrinter | null;
  update?: DisplayUpdate;
  /** A spool someone is looking for that is kept here: the display lights its row until this is gone. */
  find?: { row: DisplayRow };
}

// ---- The printer beside the display ---------------------------------------------------------

const MAX_TRAYS = 8;

/** ok: idle or done. busy: working. warn: paused, a warning, or figures that may be old. error: stopped or a fault. off: not reporting. */
export type PrinterTone = 'ok' | 'busy' | 'warn' | 'error' | 'off';

export interface DisplayPrinter {
  name: string;
  /** "Printing", "Idle", "Bridge offline" ... the web app's own words. */
  state: string;
  tone: PrinterTone;
  /** 0..1, or null when nothing is running. */
  progress: number | null;
  /** "1 h 34 min left" */
  left: string | null;
  job: string | null;
  /** "Layer 112 of 300" */
  layer: string | null;
  /** "Nozzle 220/220 C  Bed 60/60 C" */
  temps: string | null;
  /** The worst error the printer reports, in the maker's words, or its code. */
  error: string | null;
  /** Up to eight spool positions: "A1" for AMS 1 slot 1, "Ext" for an outside spool. */
  trays: Array<{ label: string; material: string | null; color: string | null; active: boolean; empty: boolean }>;
}

const PHASE_WORDS: Record<PrinterState['phase'], [string, PrinterTone]> = {
  idle: ['Idle', 'ok'],
  preparing: ['Preparing', 'busy'],
  printing: ['Printing', 'busy'],
  paused: ['Paused', 'warn'],
  finished: ['Finished', 'ok'],
  failed: ['Stopped', 'error'],
  unknown: ['Unknown', 'off'],
};

const CONNECTION_WORDS: Record<Exclude<PrinterState['connection'], 'live'>, string> = {
  printer_unreachable: 'Printer not reachable',
  bridge_offline: 'Bridge offline',
  needs_code: 'Needs access code',
  never_seen: 'Waiting for the printer',
};

const SEVERITY = { info: 0, warning: 1, error: 2, fatal: 3 } as const;

function minutesLeft(minutes: number): string {
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''} left`;
}

const temp = (label: string, t: { current: number | null; target: number | null } | null | undefined) =>
  t && t.current !== null ? `${label} ${Math.round(t.current)}${t.target ? `/${Math.round(t.target)}` : ''} C` : null;

/**
 * The printer's state worded for the display. A printer that has never been connected to a bridge gives
 * "Not connected"; one that stopped reporting keeps its last figures with the reason as its state.
 */
export function displayPrinter(name: string, state: PrinterState | null): DisplayPrinter {
  const base = { name: forDisplay(name, 32), progress: null, left: null, job: null, layer: null, temps: null, error: null, trays: [] };
  if (!state) return { ...base, state: 'Not connected', tone: 'off' };
  const [phaseWord, phaseTone] = PHASE_WORDS[state.phase] ?? PHASE_WORDS.unknown;
  const live = state.connection === 'live';
  const worst = [...state.errors].sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity])[0];
  const tone: PrinterTone = !live ? 'off' : worst && SEVERITY[worst.severity] >= 2 ? 'error' : worst?.severity === 'warning' && phaseTone !== 'error' ? 'warn' : phaseTone;
  const running = state.phase === 'printing' || state.phase === 'preparing' || state.phase === 'paused';
  const print = running ? state.print : null;
  const feederLetter = (index: number) => String.fromCharCode(65 + index);
  let amsIndex = 0;
  const trays: DisplayPrinter['trays'] = [];
  for (const feeder of state.feeders) {
    const letter = feeder.kind === 'external' ? null : feederLetter(amsIndex++);
    for (const tray of feeder.trays) {
      if (trays.length >= MAX_TRAYS) break;
      trays.push({
        label: letter ? `${letter}${tray.position}` : 'Ext',
        // The short material ("PLA", not "PLA Basic"): each spool gets about 40 pixels on the screen.
        material: tray.state === 'loaded' ? forDisplay(tray.material ?? tray.subType ?? '', 8) || null : null,
        color: tray.state === 'loaded' && tray.colour && /^#[0-9a-f]{6}$/i.test(tray.colour) ? tray.colour.toLowerCase() : null,
        active: tray.active,
        empty: tray.state !== 'loaded',
      });
    }
  }
  // The nozzle printing now: on a dual-nozzle printer the first is the right one, often not the one in use. Readings
  // saved before `active` existed fall back to the one heating to the highest target. Still worded "Nozzle", so
  // displays scale its dial the same whichever nozzle it is.
  const extruder = (
    state.extruders.find((e) => e.active) ??
    [...state.extruders].sort((a, b) => (b.temp?.target ?? 0) - (a.temp?.target ?? 0)).find((e) => (e.temp?.target ?? 0) > 0) ??
    state.extruders[0]
  )?.temp;
  return {
    ...base,
    state: state.connection === 'live' ? (print?.kind === 'laser' && state.phase === 'printing' ? 'Laser job' : phaseWord) : CONNECTION_WORDS[state.connection],
    tone,
    progress: print?.progress !== null && print?.progress !== undefined ? Math.min(1, Math.max(0, print.progress / 100)) : null,
    left: print?.remainingMinutes ? minutesLeft(print.remainingMinutes) : null,
    job: print?.name ? forDisplay(print.name, 40) : null,
    layer: print?.layer && print.totalLayers ? `Layer ${print.layer} of ${print.totalLayers}` : null,
    temps: [temp('Nozzle', extruder), temp('Bed', state.bed)].filter(Boolean).join('  ') || null,
    error: worst ? forDisplay(worst.message ?? `Error ${worst.code}`, 90) : null,
    trays,
  };
}

/** The overview for a display, of `locationId` (its own location, or one it is browsing). */
export async function buildOverview(
  db: Db,
  device: { workspaceId: string; name: string; canWrite: boolean; workspace: { name: string } },
  locationId: string | null,
  printer: DisplayPrinter | null = null,
  update: DisplayUpdate | null = null,
  find: DisplayRow | null = null,
): Promise<Overview> {
  const tree = await locationTree(db, device.workspaceId);
  const shown = locationId ? tree.byId.get(locationId) : undefined;
  let rows: DisplayRow[] = [];
  if (shown) {
    const items = await db.item.findMany({
      where: { workspaceId: device.workspaceId, archived: false, locationId: { in: tree.subtree(shown.id) } },
      select: itemSelect,
    });
    rows = items.map((item) => displayRow(item, shown.id, (id) => tree.byId.get(id)?.name ?? '')).sort(byAttention);
  }
  const locations = [...tree.byId.keys()]
    .map((id) => ({ id, name: forDisplay(tree.path(id), 48) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_LOCATIONS);
  const body = {
    poll: POLL_SECONDS,
    workspace: forDisplay(device.workspace.name),
    device: forDisplay(device.name),
    canWrite: device.canWrite,
    location: shown ? { id: shown.id, name: forDisplay(shown.name), path: forDisplay(tree.path(shown.id), 64) } : null,
    total: rows.length,
    lowCount: rows.filter((row) => row.low).length,
    items: rows.slice(0, MAX_ROWS),
    locations,
    printer,
    // Only when there is one, so displays that are not updating see the same overview as before.
    ...(update ? { update } : {}),
    // Inside what `v` is made from, so a display that already has everything else still hears of it.
    ...(find ? { find: { row: find } } : {}),
  };
  const v = createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 12);
  return { v, ...body };
}
