import type { Router } from 'express';
import type { CustomField, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Json } from '@/db';
import { HttpError, notFound, param, parse } from '@/http';
import { describeActivity } from '@/services/activity';
import { endFind, findItem } from '@/services/find';
import { assertInWorkspace, moveItems, moveStock, round, takeOut } from '@/services/stock';
import { assignTag, TAG_PATTERN } from '@/services/tags';

type FieldValue = string | number | boolean | null;

const itemInput = z.object({
  itemTypeId: z.string().min(1),
  name: z.string().trim().min(1, 'Give the item a name').max(200),
  sku: z.string().trim().max(100).optional(),
  quantity: z.number().min(0).optional(),
  capacity: z.number().positive().nullable().optional(),
  minQuantity: z.number().min(0).optional(),
  unitCost: z.number().min(0).optional(),
  unitId: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  notes: z.string().max(5000).optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  usageHours: z.number().min(0).optional(),
  lifeHours: z.number().positive().nullable().optional(),
  wearFlag: z.boolean().optional(),
  isRemnant: z.boolean().optional(),
  parentId: z.string().nullable().optional(),
  compatibleMachineIds: z.array(z.string()).optional(),
  /** The id on the spool's own tag as a connected printer read it, or "NFC" and the serial of a sticker. */
  tagId: z.string().trim().toUpperCase().regex(TAG_PATTERN).nullable().optional(),
});

const moveInput = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(200),
  locationId: z.string().nullable(),
});

const tagInput = z.object({ tagId: itemInput.shape.tagId.unwrap() });

const adjustInput = z.object({
  mode: z.enum(['delta', 'set']),
  value: z.number(),
  reason: z.enum(['restock', 'adjust']).optional(),
  note: z.string().trim().max(300).optional(),
});

const itemInclude = {
  compatibleMachines: { select: { id: true } },
  slot: { select: { position: true, label: true, subUnit: { select: { id: true, name: true, machineId: true } } } },
} satisfies Prisma.ItemInclude;

type ItemRow = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

const present = ({ compatibleMachines, ...item }: ItemRow) => ({
  ...item,
  compatibleMachineIds: compatibleMachines.map((m) => m.id),
});

/** Coerce and validate custom field values against the type's field definitions. Unknown keys are dropped. */
export function normalizeFields(definitions: CustomField[], input: Record<string, FieldValue>): Record<string, FieldValue> {
  const output: Record<string, FieldValue> = {};
  for (const field of definitions) {
    const raw = input[field.key];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (field.required) throw new HttpError(400, `${field.label} is required`);
      continue;
    }
    switch (field.fieldType) {
      case 'number': {
        const value = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(value)) throw new HttpError(400, `${field.label} must be a number`);
        output[field.key] = value;
        break;
      }
      case 'boolean':
        output[field.key] = raw === true || raw === 'true' || raw === 'yes' || raw === '1' || raw === 1;
        break;
      case 'select': {
        const options = Array.isArray(field.options) ? field.options.map(String) : [];
        const match = options.find((o) => o.toLowerCase() === String(raw).toLowerCase());
        if (!match) throw new HttpError(400, `${field.label} must be one of: ${options.join(', ')}`);
        output[field.key] = match;
        break;
      }
      case 'color':
        if (!/^#[0-9a-f]{6}$/i.test(String(raw))) throw new HttpError(400, `${field.label} must be a colour like #1a2b3c`);
        output[field.key] = String(raw).toLowerCase();
        break;
      default:
        output[field.key] = String(raw).slice(0, 500);
    }
  }
  return output;
}

export function registerItemRoutes(router: Router): void {
  router.get('/items', async (req, res) => {
    const items = await prisma.item.findMany({
      where: { workspaceId: req.workspaceId, archived: false },
      orderBy: { name: 'asc' },
      include: itemInclude,
    });
    res.json(items.map(present));
  });

  router.post('/items', async (req, res) => {
    const { compatibleMachineIds = [], fields = {}, tagId, ...data } = parse(itemInput, req.body);
    const workspaceId = req.workspaceId;
    await assertInWorkspace(prisma, workspaceId, {
      itemType: data.itemTypeId, unit: data.unitId, supplier: data.supplierId,
      location: data.locationId, item: data.parentId, machine: compatibleMachineIds,
    });
    const type = await prisma.itemType.findUniqueOrThrow({ where: { id: data.itemTypeId }, include: { fields: true } });

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.item.create({
        data: {
          ...data,
          workspaceId,
          unitId: data.unitId === undefined ? type.defaultUnitId : data.unitId,
          fields: normalizeFields(type.fields, fields) as Json,
          compatibleMachines: { connect: compatibleMachineIds.map((id) => ({ id })) },
        },
      });
      if (created.quantity > 0) {
        await tx.stockMovement.create({
          data: { workspaceId, itemId: created.id, delta: created.quantity, balanceAfter: created.quantity, reason: 'initial', userId: req.userId },
        });
      }
      if (tagId) await assignTag(tx, workspaceId, created.id, tagId);
      return tx.item.findUniqueOrThrow({ where: { id: created.id }, include: itemInclude });
    });
    res.status(201).json(present(item));
  });

  router.patch('/items/:id', async (req, res) => {
    const { compatibleMachineIds, fields, quantity, tagId, ...data } = parse(itemInput.partial(), req.body);
    const id = param(req, 'id');
    const workspaceId = req.workspaceId;
    const existing = await prisma.item.findFirst({ where: { id, workspaceId } });
    if (!existing) throw notFound('Item');
    if (data.parentId === id) throw new HttpError(400, 'An item cannot be an offcut of itself');
    await assertInWorkspace(prisma, workspaceId, {
      itemType: data.itemTypeId, unit: data.unitId, supplier: data.supplierId,
      location: data.locationId, item: data.parentId, machine: compatibleMachineIds,
    });

    let normalized: Record<string, FieldValue> | undefined;
    if (fields || (data.itemTypeId && data.itemTypeId !== existing.itemTypeId)) {
      const type = await prisma.itemType.findUniqueOrThrow({
        where: { id: data.itemTypeId ?? existing.itemTypeId },
        include: { fields: true },
      });
      normalized = normalizeFields(type.fields, fields ?? (existing.fields as Record<string, FieldValue>));
    }

    const item = await prisma.$transaction(async (tx) => {
      await tx.item.update({
        where: { id },
        data: {
          ...data,
          // Given a place by hand, it is no longer on the move.
          ...(data.locationId ? { outSince: null } : {}),
          ...(normalized ? { fields: normalized as Json } : {}),
          ...(compatibleMachineIds ? { compatibleMachines: { set: compatibleMachineIds.map((machineId) => ({ id: machineId })) } } : {}),
        },
      });
      if (tagId !== undefined) await assignTag(tx, workspaceId, id, tagId);
      // Editing the quantity on the form is still a stock change and must be audited.
      if (quantity !== undefined && quantity !== existing.quantity) {
        await moveStock(tx, { workspaceId, itemId: id, delta: quantity - existing.quantity, reason: 'adjust', note: 'Edited on item form', userId: req.userId });
      }
      return tx.item.findUniqueOrThrow({ where: { id }, include: itemInclude });
    });
    res.json(present(item));
  });

  router.delete('/items/:id', async (req, res) => {
    const id = param(req, 'id');
    const existing = await prisma.item.findFirst({ where: { id, workspaceId: req.workspaceId }, include: { _count: { select: { jobUsages: true } } } });
    if (!existing) throw notFound('Item');
    if (existing._count.jobUsages > 0) {
      // Keep job history and costs intact: retire the item instead of erasing it.
      await prisma.$transaction([
        prisma.slot.updateMany({ where: { itemId: id }, data: { itemId: null } }),
        prisma.item.update({ where: { id }, data: { archived: true } }),
      ]);
    } else {
      await prisma.item.delete({ where: { id } });
    }
    res.status(204).end();
  });

  /** Fast workbench adjustment: +/- a delta, or set the exact amount after weighing/counting. */
  router.post('/items/:id/adjust', async (req, res) => {
    const { mode, value, reason, note } = parse(adjustInput, req.body);
    const id = param(req, 'id');
    const workspaceId = req.workspaceId;
    const item = await prisma.$transaction(async (tx) => {
      const current = await tx.item.findFirst({ where: { id, workspaceId } });
      if (!current) throw notFound('Item');
      if (mode === 'set' && value < 0) throw new HttpError(400, 'Quantity cannot be negative');
      const delta = mode === 'set' ? round(value - current.quantity) : value;
      // Operators log what they use; adding stock or correcting it upwards is an inventory change.
      if (req.role === 'operator' && delta > 0) throw new HttpError(403, 'Operators can log usage but not add stock. Ask an admin.');
      await moveStock(tx, {
        workspaceId, itemId: id, delta, note, userId: req.userId,
        reason: reason ?? (delta > 0 && mode === 'delta' ? 'restock' : 'adjust'),
      });
      return tx.item.findUniqueOrThrow({ where: { id }, include: itemInclude });
    });
    res.json(present(item));
  });

  /** Put items away somewhere else (or nowhere). Putting things back where they belong is everyday bench work. */
  router.post('/items/move', async (req, res) => {
    const { itemIds, locationId } = parse(moveInput, req.body);
    const { moved, summary, entityId } = await moveItems(prisma, req.workspaceId, itemIds, locationId);
    describeActivity(summary, { type: 'item', id: entityId });
    res.json({ moved: moved.length });
  });

  /**
   * "Where is this?", from a scanned label say. Answers where the item is, and the location display nearest to
   * it lights its row for two minutes or until it is taken out.
   */
  router.post('/items/:id/find', async (req, res) => {
    const id = param(req, 'id');
    const found = await findItem(prisma, req.workspaceId, id);
    if (!found) throw notFound('Item');
    const { displays } = found.answer;
    describeActivity(displays.length ? `Looked for ${found.name} on ${displays.map((display) => display.name).join(', ')}` : `Looked for ${found.name}`, { type: 'item', id });
    res.json(found.answer);
  });

  /** Stop looking: the display goes back to its list on its next check. */
  router.delete('/items/:id/find', async (req, res) => {
    const id = param(req, 'id');
    const item = await prisma.item.findFirst({ where: { id, workspaceId: req.workspaceId }, select: { name: true } });
    if (!item) throw notFound('Item');
    endFind(req.workspaceId, id);
    describeActivity(`Stopped looking for ${item.name}`, { type: 'item', id });
    res.status(204).end();
  });

  /** Picking an item off its shelf: it is "on the move" until it is put away or a printer reports it loaded. */
  router.post('/items/:id/take-out', async (req, res) => {
    const id = param(req, 'id');
    const workspaceId = req.workspaceId;
    const current = await prisma.item.findFirst({
      where: { id, workspaceId, archived: false },
      select: { id: true, name: true, outSince: true, location: { select: { name: true } }, slot: { select: { position: true, subUnit: { select: { name: true } } } } },
    });
    if (!current) throw notFound('Item');
    if (current.slot) throw new HttpError(409, `${current.name} is loaded in ${current.slot.subUnit.name} slot ${current.slot.position}. Unload it first.`);
    if (!current.location) throw new HttpError(409, current.outSince ? `${current.name} is already on the move` : `${current.name} has no location to take it out of`);
    describeActivity(await takeOut(prisma, current, current.location.name), { type: 'item', id });
    endFind(workspaceId, id);
    res.json(present(await prisma.item.findUniqueOrThrow({ where: { id }, include: itemInclude })));
  });

  /** Tie a tag to this item (a sticker just written, say), or forget it. The tag leaves any other item. */
  router.put('/items/:id/tag', async (req, res) => {
    const { tagId } = parse(tagInput, req.body);
    const id = param(req, 'id');
    const workspaceId = req.workspaceId;
    const item = await prisma.$transaction(async (tx) => {
      const current = await tx.item.findFirst({ where: { id, workspaceId, archived: false } });
      if (!current) throw notFound('Item');
      await assignTag(tx, workspaceId, id, tagId);
      return tx.item.findUniqueOrThrow({ where: { id }, include: itemInclude });
    });
    describeActivity(tagId ? `Tagged ${item.name}` : `Removed the tag from ${item.name}`, { type: 'item', id });
    res.json(present(item));
  });

  router.get('/items/:id/movements', async (req, res) => {
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { item: id });
    const movements = await prisma.stockMovement.findMany({
      where: { itemId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { name: true } }, job: { select: { id: true, name: true } } },
    });
    res.json(movements);
  });
}
