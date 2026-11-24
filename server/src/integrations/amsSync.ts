import { Prisma } from '@prisma/client';
import { prisma, type Json } from '@/db';
import { compatible, detectedFrom, traySignature, type Detected, type SpoolFacts } from '@/integrations/spoolMatch';
import type { Feeder, PrinterAdapter, PrinterReading } from '@/integrations/types';
import { logSystemActivity } from '@/services/activity';
import { assignTag } from '@/services/tags';

/**
 * Keeps a machine's attached hardware in step with what its printer reports: one sub-unit per filament
 * feeder (and per outside spool holder that has been used), one slot per tray, the feeder's readings, and
 * which stock item sits in each slot.
 *
 * It only acts when a tray physically changes. It never re-asserts a choice, so a member who loads a slot
 * by hand is left alone until the spool in that tray is swapped.
 *
 * Spools "on the move" (tapped out at a location display's reader, Item.outSince) are looked for here: when a
 * tray is loaded with something the printer cannot name by its tag, and exactly one spool on the move fits what
 * the printer reports, that spool is what went in.
 */

export interface SyncTarget {
  workspaceId: string;
  machineId: string;
  machineName: string;
  serial: string;
  adapter: PrinterAdapter;
}

export interface SyncResult {
  /** Something the screens show changed. */
  changed: boolean;
  /** A tray went empty too recently to trust; look again after this many ms. */
  retryInMs: number | null;
  /** What became of a spool that was scanned to go in next; null while it is still waiting for a tray to change. */
  pending: PendingOutcome | null;
}

/**
 * "Scan, then insert": a member scanned a spool and said it goes into this printer next. The next single tray
 * to be loaded is that spool, which ties an exact stock item to a tray whose spool the printer cannot identify.
 */
export interface PendingSpool {
  itemId: string;
  /** ms since epoch; after this the scan no longer counts. */
  expiresAt: number;
}

export type PendingOutcome =
  /** `mismatch`: the printer describes the tray as a different filament (often a preset left from the last spool). */
  | { result: 'linked'; place: string; mismatch: boolean }
  /** More than one tray changed, or the item is gone: nothing was linked rather than guess. */
  | { result: 'dropped'; reason: 'several' | 'gone' };

/** A tray must read empty for this long before its slot is unloaded: trays blink empty while a tag is read. */
export const EMPTY_SETTLE_MS = 30_000;

type Tx = Prisma.TransactionClient;
const subUnitInclude = { slots: { orderBy: { position: 'asc' }, include: { item: { include: { itemType: { include: { fields: true } } } } } } } satisfies Prisma.SubUnitInclude;
type SubUnitRow = Prisma.SubUnitGetPayload<{ include: typeof subUnitInclude }>;
type SlotRow = SubUnitRow['slots'][number];

function readingsFor(feeder: Feeder): Array<{ label: string; value: string; unit: string }> {
  const readings: Array<{ label: string; value: string; unit: string }> = [];
  if (feeder.humidityPercent !== null) readings.push({ label: 'Humidity', value: String(Math.round(feeder.humidityPercent)), unit: '%' });
  else if (feeder.humidityLevel !== null) readings.push({ label: 'Dryness', value: `${feeder.humidityLevel} of 5`, unit: '' });
  if (feeder.temperature !== null) readings.push({ label: 'Temperature', value: String(Math.round(feeder.temperature)), unit: '°C' });
  return readings;
}

/** "Drying PETG at 65 °C, about 11 h 56 min left". Starts with "Drying" whenever a cycle is running. */
export function statusNoteFor(feeder: Feeder): string {
  if (!feeder.drying) return '';
  const { remainingMinutes: minutes, targetTemp, filament } = feeder.drying;
  const what = `Drying${filament ? ` ${filament}` : ''}${targetTemp ? ` at ${Math.round(targetTemp)} °C` : ''}`;
  if (minutes === null) return what;
  const left = minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
  return `${what}, about ${left} left`;
}

const isDrying = (statusNote: string) => statusNote.startsWith('Drying');

/** The material, colour and tag of a stock item, read from its type's own fields (workspaces name them freely). */
/** What spoolFacts reads from a stock item: its field values, its type's fields and its tag. */
export interface SpoolFactsSource {
  fields: Prisma.JsonValue;
  tagId: string | null;
  itemType: { fields: Array<{ key: string; label: string; fieldType: string }> };
}

export function spoolFacts(item: SpoolFactsSource): SpoolFacts {
  const values = (item.fields ?? {}) as Record<string, unknown>;
  const fields = item.itemType.fields;
  const materialField = fields.find((field) => field.key === 'material') ?? fields.find((field) => /material/i.test(field.label));
  const colourField = fields.find((field) => field.fieldType === 'color');
  const material = materialField ? values[materialField.key] : undefined;
  const colour = colourField ? values[colourField.key] : undefined;
  return {
    material: typeof material === 'string' && material ? material : null,
    colour: typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour) ? colour : null,
    tagId: item.tagId,
  };
}

const describeTray = (detected: Detected) => [detected.subType ?? detected.material, detected.colour].filter(Boolean).join(' ');

/** Find the sub-unit the printer already manages, adopt a hand-made one that fits, or make a new one. */
async function subUnitFor(tx: Tx, target: SyncTarget, feeder: Feeder, externalId: string): Promise<{ row: SubUnitRow; created: boolean } | null> {
  const existing = await tx.subUnit.findFirst({ where: { workspaceId: target.workspaceId, externalId }, include: subUnitInclude });
  if (existing) return { row: existing, created: false };
  // An outside spool holder only earns a place on the page once something has been on it.
  if (feeder.kind === 'external' && feeder.trays.every((tray) => tray.state === 'empty')) return null;

  // Someone who modelled their AMS by hand keeps it (and what is loaded in it) rather than getting a twin.
  const handMade = await tx.subUnit.findMany({
    where: { workspaceId: target.workspaceId, machineId: target.machineId, externalId: null },
    orderBy: { name: 'asc' },
    include: { _count: { select: { slots: true } } },
  });
  const adopt = feeder.kind === 'external' ? undefined : handMade.find((unit) => unit._count.slots === feeder.trays.length);
  if (adopt) {
    const row = await tx.subUnit.update({ where: { id: adopt.id }, data: { externalId }, include: subUnitInclude });
    return { row, created: true };
  }
  const row = await tx.subUnit.create({
    data: {
      workspaceId: target.workspaceId, machineId: target.machineId, name: feeder.label, kind: feeder.kindLabel,
      externalId, readings: readingsFor(feeder) as Json, statusNote: statusNoteFor(feeder),
      slots: { create: feeder.trays.map((tray) => ({ position: tray.position })) },
    },
    include: subUnitInclude,
  });
  return { row, created: true };
}

/**
 * Bring one printer's feeders, slots and loaded spools up to date.
 * `emptySince` remembers, between calls, when each tray was first seen empty.
 */
export async function syncFeeders(target: SyncTarget, reading: PrinterReading, emptySince: Map<string, number>, now = Date.now(), pending: PendingSpool | null = null): Promise<SyncResult> {
  const notes: string[] = [];
  let changed = false;
  let retryInMs: number | null = null;
  let outcome: PendingOutcome | null = null;
  const waiting = pending && now < pending.expiresAt ? pending : null;
  /** Trays that were just loaded with a spool the printer cannot tie to stock by its own tag. */
  const inserted: Array<{ slotId: string; place: string; tray: Feeder['trays'][number]; itemId: string | null }> = [];
  /** Items taken out of a slot in this pass. */
  const unloaded: string[] = [];
  /** Items a tag has just placed somewhere in this pass; any other slot's memory of holding them is stale. */
  const placed = new Set<string>();

  await prisma.$transaction(
    async (tx) => {
      for (const feeder of reading.feeders) {
        const externalId = target.adapter.externalId(target.serial, feeder.key);
        const found = await subUnitFor(tx, target, feeder, externalId);
        if (!found) continue;
        let { row } = found;
        if (found.created) changed = true;

        // Readings, status and where it is attached follow the printer.
        const readings = readingsFor(feeder);
        const statusNote = statusNoteFor(feeder);
        if (JSON.stringify(row.readings) !== JSON.stringify(readings) || row.statusNote !== statusNote || row.machineId !== target.machineId) {
          await tx.subUnit.update({ where: { id: row.id }, data: { readings: readings as Json, statusNote, machineId: target.machineId } });
          changed = true;
        }
        // A drying cycle that was running last time and is not now has ended: the spools in this unit were just dried.
        if (isDrying(row.statusNote) && !feeder.drying) {
          const dried: string[] = [];
          for (const slot of row.slots) {
            const field = slot.item?.itemType.fields.find((candidate) => candidate.key === 'last_dried' && candidate.fieldType === 'date');
            if (!slot.item || !field) continue;
            const values = (slot.item.fields ?? {}) as Record<string, unknown>;
            await tx.item.update({ where: { id: slot.item.id }, data: { fields: { ...values, [field.key]: new Date(now).toISOString().slice(0, 10) } as Json } });
            dried.push(slot.item.name);
          }
          if (dried.length) notes.push(`Marked ${dried.join(' and ')} as dried today: the drying cycle in ${row.name} ended`);
        }
        const missing = feeder.trays.filter((tray) => !row.slots.some((slot) => slot.position === tray.position));
        if (missing.length) {
          await tx.slot.createMany({ data: missing.map((tray) => ({ subUnitId: row.id, position: tray.position })) });
          row = await tx.subUnit.findUniqueOrThrow({ where: { id: row.id }, include: subUnitInclude });
          changed = true;
        }

        for (const tray of feeder.trays) {
          const found = row.slots.find((candidate) => candidate.position === tray.position);
          if (!found) continue;
          const slot = found.itemId && placed.has(found.itemId) ? { ...found, itemId: null, item: null } : found;
          const previous = slot.detected as Detected | null;
          const signature = traySignature(tray);
          const settleKey = `${externalId}:${tray.position}`;
          const place = `${row.name} slot ${tray.position}`;

          if (previous?.signature === signature) {
            // Read empty for a moment and now the same again: a spool was taken out and one that looks the same
            // put in. Nothing to do by itself, but it is what a scanned spool is waiting for.
            if (waiting && emptySince.has(settleKey) && tray.state === 'loaded' && !tray.tagId) inserted.push({ slotId: slot.id, place, tray, itemId: slot.itemId });
            emptySince.delete(settleKey);
            // Same spool: only the amount left may have moved.
            if (previous.remainingPercent !== tray.remainingPercent || previous.spoolWeightGrams !== tray.spoolWeightGrams) {
              await tx.slot.update({ where: { id: slot.id }, data: { detected: detectedFrom(tray, previous.boundSignature) as unknown as Json } });
              changed = true;
            }
            continue;
          }

          // The tray holds something else than last time (or this is the first look at it).
          let itemId = slot.itemId;
          let source = slot.source;
          let boundSignature: string | null = previous?.boundSignature ?? null;

          if (tray.state === 'empty') {
            if (slot.itemId && previous) {
              const since = emptySince.get(settleKey) ?? now;
              emptySince.set(settleKey, since);
              const wait = EMPTY_SETTLE_MS - (now - since);
              if (wait > 0) {
                retryInMs = Math.min(retryInMs ?? wait, wait);
                continue;
              }
            }
            emptySince.delete(settleKey);
            if (slot.itemId) {
              notes.push(`Unloaded ${slot.item?.name ?? 'a spool'} from ${place}`);
              unloaded.push(slot.itemId);
              itemId = null;
              source = 'manual';
            }
            boundSignature = null;
          } else {
            emptySince.delete(settleKey);
            const tagged = tray.tagId
              ? await tx.item.findFirst({ where: { workspaceId: target.workspaceId, tagId: tray.tagId, archived: false }, select: { id: true, name: true } })
              : null;
            // Not the first look at this tray, so a spool was really put in; and not one a tag already settles.
            if (tagged) {
              // The tag says exactly which spool this is.
              if (slot.itemId !== tagged.id) {
                await tx.slot.updateMany({ where: { itemId: tagged.id, NOT: { id: slot.id } }, data: { itemId: null, source: 'manual' } });
                notes.push(`Loaded ${tagged.name} into ${place}`);
                itemId = tagged.id;
              }
              placed.add(tagged.id);
              // Wherever it was on its way to, it has arrived.
              await tx.item.updateMany({ where: { id: tagged.id, outSince: { not: null } }, data: { outSince: null } });
              source = 'printer';
              boundSignature = signature;
            } else if (slot.item) {
              // No tag we know. On the first look, trust what a member set; after that, keep it only if it still fits.
              const keep = !previous || compatible(spoolFacts(slot.item), tray);
              if (keep) boundSignature = signature;
              else {
                notes.push(`Unloaded ${slot.item.name} from ${place}: the printer now reports ${describeTray(detectedFrom(tray, null)) || 'a different spool'} there`);
                unloaded.push(slot.item.id);
                itemId = null;
                source = 'manual';
                boundSignature = null;
              }
            } else boundSignature = null;
            // Not the first look at this tray, so a spool was really put in; and not one a tag already settles.
            if (!tagged && previous) inserted.push({ slotId: slot.id, place, tray, itemId });
          }

          await tx.slot.update({
            where: { id: slot.id },
            data: { itemId, source, detected: detectedFrom(tray, boundSignature) as unknown as Json },
          });
          changed = true;
        }
      }

      // A spool scanned to go in next: it is the one tray that was just loaded. Two at once could be either way
      // round, so nothing is linked; none yet means it is still on its way to the printer.
      let linkedSlotId: string | null = null;
      if (waiting && inserted.length > 1) outcome = { result: 'dropped', reason: 'several' };
      else if (waiting && inserted.length === 1) {
        const [{ slotId, place, tray }] = inserted;
        const item = await tx.item.findFirst({ where: { id: waiting.itemId, workspaceId: target.workspaceId, archived: false }, include: { itemType: { include: { fields: true } } } });
        if (!item) outcome = { result: 'dropped', reason: 'gone' };
        else {
          const signature = traySignature(tray);
          await tx.slot.updateMany({ where: { itemId: item.id, NOT: { id: slotId } }, data: { itemId: null, source: 'manual' } });
          // A member's choice, as if they had picked the slot by hand: it stands until the tray changes again.
          await tx.slot.update({ where: { id: slotId }, data: { itemId: item.id, source: 'manual', detected: detectedFrom(tray, signature) as unknown as Json } });
          if (item.outSince) await tx.item.update({ where: { id: item.id }, data: { outSince: null } });
          linkedSlotId = slotId;
          // A tag of its own that the printer reads and nothing in stock has yet: now it is this spool's.
          if (tray.tagId && !item.tagId) await assignTag(tx, target.workspaceId, item.id, tray.tagId);
          const mismatch = !compatible({ ...spoolFacts(item), tagId: null }, { material: tray.material, colour: tray.colour, tagId: null });
          notes.push(`Loaded ${item.name} into ${place}: it was scanned just before going in`);
          outcome = { result: 'linked', place, mismatch };
          changed = true;
        }
      }

      // Where a display has a tag reader, a spool that leaves a printer with no place to be is in someone's hands.
      if (unloaded.length && (await tx.device.count({ where: { workspaceId: target.workspaceId, hasReader: true } })) > 0) {
        await tx.item.updateMany({ where: { id: { in: unloaded }, locationId: null, outSince: null, slot: null }, data: { outSince: new Date(now) } });
      }

      // Spools on the move: a tray just loaded with something no tag names is one of them, if exactly one fits
      // what the printer reports. Two that fit could be either, so neither is loaded.
      const open = inserted.filter((entry) => entry.slotId !== linkedSlotId && !entry.itemId);
      if (open.length) {
        let moving = await tx.item.findMany({
          where: { workspaceId: target.workspaceId, archived: false, outSince: { not: null }, slot: null },
          include: { itemType: { include: { fields: true } } },
          orderBy: { outSince: 'asc' },
        });
        for (const { slotId, place, tray } of open) {
          const fits = moving.filter((item) => compatible(spoolFacts(item), tray));
          if (fits.length > 1) {
            notes.push(`${fits.length} spools on the move could be what went into ${place} (${fits.slice(0, 3).map((item) => item.name).join(', ')}): choose it there`);
            continue;
          }
          const [item] = fits;
          if (!item) continue;
          moving = moving.filter((other) => other.id !== item.id);
          await tx.slot.update({ where: { id: slotId }, data: { itemId: item.id, source: 'manual', detected: detectedFrom(tray, traySignature(tray)) as unknown as Json } });
          if (tray.tagId && !item.tagId) await assignTag(tx, target.workspaceId, item.id, tray.tagId);
          await tx.item.update({ where: { id: item.id }, data: { outSince: null } });
          notes.push(`Loaded ${item.name} into ${place}: it was on the move and is what the printer reports there`);
          changed = true;
        }
      }
    },
    { timeout: 30_000 },
  );

  if (notes.length) {
    const summary = notes.length > 3 ? `${notes.slice(0, 3).join('; ')}; and ${notes.length - 3} more` : notes.join('; ');
    await logSystemActivity({
      workspaceId: target.workspaceId, actor: target.machineName, action: 'printer.slots',
      entityType: 'machine', entityId: target.machineId, summary,
    });
  }
  return { changed, retryInMs, pending: outcome };
}

/** When a printer is unlinked its feeders become ordinary hand-kept hardware again; nothing loaded is lost. */
export async function releaseFeeders(db: Tx | typeof prisma, workspaceId: string, vendor: string, serial: string): Promise<void> {
  const units = await db.subUnit.findMany({ where: { workspaceId, externalId: { startsWith: `${vendor}:${serial}:` } }, select: { id: true } });
  if (units.length === 0) return;
  const ids = units.map((unit) => unit.id);
  await db.slot.updateMany({ where: { subUnitId: { in: ids } }, data: { detected: Prisma.DbNull, source: 'manual' } });
  await db.subUnit.updateMany({ where: { id: { in: ids } }, data: { externalId: null } });
}
