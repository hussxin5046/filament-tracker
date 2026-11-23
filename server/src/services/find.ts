import type { Prisma } from '@prisma/client';
import type { Db } from '@/db';
import { displayOnline, itemSelect, locationTree } from '@/services/deviceOverview';
import { compareVersions } from '@/services/firmware';

/**
 * Finding a spool: a member asks where an item is (from a scanned label, say) and the location display nearest
 * to it lights that item up until it is taken out or two minutes pass.
 *
 * Only the item and when the find ends are kept, in this process (the app runs as a single instance, like the
 * spools waiting to go into a printer). Which display lights is worked out from where the item is kept at the
 * moment a display asks, so an item that was put away elsewhere, loaded into a machine, taken out or retired
 * since stops being lit by itself.
 */

export const FIND_MS = 2 * 60_000;
/** The first display firmware that shows a find. Older displays keep working and show nothing. */
export const FIND_FIRMWARE = '0.4.0';

/** Workspace id to the items being looked for, each with the time its find ends. */
const finds = new Map<string, Map<string, number>>();

export function startFind(workspaceId: string, itemId: string, now = Date.now()): number {
  const endsAt = now + FIND_MS;
  const inWorkspace = finds.get(workspaceId) ?? new Map<string, number>();
  inWorkspace.set(itemId, endsAt);
  finds.set(workspaceId, inWorkspace);
  return endsAt;
}

export function endFind(workspaceId: string, itemId: string): void {
  const inWorkspace = finds.get(workspaceId);
  if (!inWorkspace?.delete(itemId)) return;
  if (!inWorkspace.size) finds.delete(workspaceId);
}

/** The items being looked for right now, newest first. Finds that have run out are dropped here. */
function looking(workspaceId: string, now: number): string[] {
  const inWorkspace = finds.get(workspaceId);
  if (!inWorkspace) return [];
  for (const [itemId, endsAt] of inWorkspace) if (endsAt <= now) inWorkspace.delete(itemId);
  if (!inWorkspace.size) finds.delete(workspaceId);
  return [...inWorkspace].sort((a, b) => b[1] - a[1]).map(([itemId]) => itemId);
}

/** Whether someone is looking for this item right now, lit on a display or waiting behind a newer find. */
export const isSought = (workspaceId: string, itemId: string, now = Date.now()) => looking(workspaceId, now).includes(itemId);

type Tree = Awaited<ReturnType<typeof locationTree>>;

/**
 * The displays that show `locationId` most closely: those on the location itself, or else on the nearest
 * location it sits inside. A shelf's own display is chosen over the display of the rack the shelf is in.
 */
export function nearestDisplays<T extends { locationId: string | null }>(tree: Tree, displays: T[], locationId: string): T[] {
  const seen = new Set<string>();
  for (let at = tree.byId.get(locationId); at && !seen.has(at.id); at = at.parentId ? tree.byId.get(at.parentId) : undefined) {
    seen.add(at.id);
    const here = displays.filter((display) => display.locationId === at.id);
    if (here.length) return here;
  }
  return [];
}

/**
 * The item this display should light up, if any: one being looked for whose nearest display it is. A display
 * lights one spool at a time, the one asked for last; an earlier one lights when that is taken out.
 */
export async function findForDevice(db: Db, device: { id: string; workspaceId: string }, now = Date.now()) {
  const ids = looking(device.workspaceId, now);
  if (!ids.length) return null;
  const [items, displays, tree] = await Promise.all([
    db.item.findMany({ where: { id: { in: ids }, workspaceId: device.workspaceId, archived: false, locationId: { not: null }, slot: null }, select: itemSelect }),
    db.device.findMany({ where: { workspaceId: device.workspaceId }, select: { id: true, locationId: true } }),
    locationTree(db, device.workspaceId),
  ]);
  for (const id of ids) {
    const item = items.find((candidate) => candidate.id === id);
    if (item?.locationId && nearestDisplays(tree, displays, item.locationId).some((display) => display.id === device.id)) return item;
  }
  return null;
}

const whereSelect = {
  id: true, name: true, locationId: true, outSince: true,
  slot: { select: { position: true, subUnit: { select: { name: true, machine: { select: { name: true } } } } } },
} satisfies Prisma.ItemSelect;

export interface FindAnswer {
  /**
   * lit: a display is showing it. offline: its display is not reporting, so it will light when it is back.
   * no-display: no display shows where it is kept. loaded: it is in a machine. on-the-move: it was taken out.
   * nowhere: it has no location.
   */
  state: 'lit' | 'offline' | 'no-display' | 'loaded' | 'on-the-move' | 'nowhere';
  /** Where it is: a location's path, or "X1C, AMS 1 slot 2". */
  place: string | null;
  /** The displays asked to light it. `outdated`: its firmware is too old to show a find. */
  displays: Array<{ name: string; online: boolean; outdated: boolean }>;
  /** When the displays stop lighting it (lit and offline only). */
  expiresAt: number | null;
}

/** Where an item is, lighting the display nearest to it when there is one. Null when the item is not in stock. */
export async function findItem(db: Db, workspaceId: string, itemId: string): Promise<{ name: string; answer: FindAnswer } | null> {
  const item = await db.item.findFirst({ where: { id: itemId, workspaceId, archived: false }, select: whereSelect });
  if (!item) return null;
  const nothing = { displays: [], expiresAt: null };
  if (item.slot) {
    const { subUnit, position } = item.slot;
    return { name: item.name, answer: { ...nothing, state: 'loaded', place: [subUnit.machine?.name, `${subUnit.name} slot ${position}`].filter(Boolean).join(', ') } };
  }
  if (!item.locationId) return { name: item.name, answer: { ...nothing, state: item.outSince ? 'on-the-move' : 'nowhere', place: null } };

  const [tree, displays] = await Promise.all([
    locationTree(db, workspaceId),
    db.device.findMany({ where: { workspaceId }, select: { name: true, locationId: true, lastSeenAt: true, tokenHash: true, version: true } }),
  ]);
  const place = tree.path(item.locationId);
  const nearest = nearestDisplays(tree, displays, item.locationId).map((display) => ({
    name: display.name,
    online: display.tokenHash !== null && displayOnline(display.lastSeenAt),
    outdated: (compareVersions(display.version, FIND_FIRMWARE) ?? 0) < 0,
  }));
  if (!nearest.length) return { name: item.name, answer: { ...nothing, state: 'no-display', place } };
  const expiresAt = startFind(workspaceId, item.id);
  return { name: item.name, answer: { state: nearest.some((display) => display.online) ? 'lit' : 'offline', place, displays: nearest, expiresAt } };
}
