import type { Db } from '@/db';
import { HttpError } from '@/http';
import { noteMovement } from '@/services/activity';

export const round = (value: number, places = 4): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

interface MoveInput {
  workspaceId: string;
  itemId: string;
  delta: number;
  reason: 'initial' | 'restock' | 'adjust' | 'job' | 'maintenance' | 'import' | 'undo';
  note?: string;
  jobId?: string | null;
  userId?: string | null;
}

/**
 * The only way stock should change after creation. Never lets a quantity go below zero
 * and always leaves an audit row, so the level on screen can be traced back.
 * Must be called inside a transaction.
 */
export async function moveStock(db: Db, { workspaceId, itemId, delta, reason, note = '', jobId = null, userId = null }: MoveInput): Promise<void> {
  const item = await db.item.findFirst({ where: { id: itemId, workspaceId } });
  if (!item) throw new HttpError(404, 'Item not found');
  const balance = Math.max(0, round(item.quantity + delta));
  const applied = round(balance - item.quantity);
  if (applied === 0) return;
  await db.item.update({ where: { id: itemId }, data: { quantity: balance } });
  const movement = await db.stockMovement.create({
    data: { workspaceId, itemId, delta: applied, balanceAfter: balance, reason, note, jobId, userId },
  });
  noteMovement(movement.id);
}

/**
 * Put items away somewhere else (null: nowhere). Items already there are left alone. Given a place, an item is
 * no longer "on the move". Returns what moved and a
 * sentence for the activity log; the caller writes the entry, since a member and a location display log differently.
 */
export async function moveItems(db: Db, workspaceId: string, itemIds: string[], locationId: string | null) {
  const ids = [...new Set(itemIds)];
  await assertInWorkspace(db, workspaceId, { item: ids, location: locationId });
  const [location, items] = await Promise.all([
    locationId ? db.location.findUnique({ where: { id: locationId }, select: { name: true } }) : null,
    db.item.findMany({ where: { id: { in: ids }, workspaceId }, select: { id: true, name: true, locationId: true }, orderBy: { name: 'asc' } }),
  ]);
  const moving = items.filter((item) => item.locationId !== locationId);
  if (moving.length) await db.item.updateMany({ where: { id: { in: moving.map((item) => item.id) }, workspaceId }, data: { locationId, ...(locationId ? { outSince: null } : {}) } });
  const what = moving.length === 1 ? moving[0].name : `${moving.length} items`;
  const summary =
    moving.length === 0 ? 'Moved nothing: already there' : location ? `Moved ${what} to ${location.name}` : `Took ${what} out of ${moving.length === 1 ? 'its' : 'their'} location`;
  return { moved: moving, summary, entityId: moving.length === 1 ? moving[0].id : null };
}

/**
 * Take an item out of where it is kept: it has no location and is "on the move" until it is put away or a
 * printer reports it loaded. `place` is the location it leaves, for the activity log; the caller writes the
 * entry, since a member and a location display log differently.
 */
export async function takeOut(db: Db, item: { id: string; name: string }, place: string): Promise<string> {
  await db.item.update({ where: { id: item.id }, data: { locationId: null, outSince: new Date() } });
  return `Took ${item.name} out of ${place}: it is on the move`;
}

/** Ensure referenced rows belong to this workspace before linking to them. */
export async function assertInWorkspace(
  db: Db,
  workspaceId: string,
  refs: Partial<Record<'unit' | 'supplier' | 'location' | 'itemType' | 'machineType' | 'machine' | 'item' | 'project', string | null | undefined | string[]>>,
): Promise<void> {
  const checks: Array<[string, string[], Promise<number>]> = [];
  for (const [model, value] of Object.entries(refs)) {
    const ids = [...new Set((Array.isArray(value) ? value : [value]).filter((v): v is string => Boolean(v)))];
    if (!ids.length) continue;
    // Each delegate shares the same count() shape; index access keeps this helper generic.
    const delegate = (db as unknown as Record<string, { count(args: unknown): Promise<number> }>)[model];
    checks.push([model, ids, delegate.count({ where: { id: { in: ids }, workspaceId } })]);
  }
  for (const [model, ids, pending] of checks) {
    if ((await pending) !== ids.length) throw new HttpError(400, `Unknown ${model} for this workspace`);
  }
}
