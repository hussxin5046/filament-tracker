import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/db';
import { FIND_MS } from '@/services/find';
import { member, startApp } from './http';

/**
 * Finding a spool from a scanned label: the location display nearest to where it is kept lights its row until
 * it is taken out (on the display, at its reader, or in the app) or two minutes pass.
 */

let app: Awaited<ReturnType<typeof startApp>>;
let workspaceId: string;
let typeId: string;
let gramsId: string;
let admin: string;
let operator: string;
let viewer: string;
let rack: string;
let shelf: string;
let drawer: string;
let rackToken: string;
let shelfToken: string;
let shelfDisplayId: string;
const ws = (path: string) => `/workspaces/${workspaceId}${path}`;
const spool = (name: string, extra: { tagId?: string; locationId?: string; outSince?: Date } = {}) =>
  prisma.item.create({ data: { workspaceId, itemTypeId: typeId, unitId: gramsId, name, quantity: 500, fields: { material: 'PLA', colour: '#101010' }, ...extra } });
const itemNow = (id: string) => prisma.item.findUniqueOrThrow({ where: { id } });
const find = (id: string, as = operator) => app.call('POST', ws(`/items/${id}/find`), as);
const overview = async (token: string, query = '') => (await app.call('GET', `/device/overview${query}`, token)).body as { v: string; find?: { row: { id: string; name: string; at: string | null } } };
const lit = async (token: string) => (await overview(token)).find?.row.name ?? null;

async function display(name: string, locationId: string, version: string) {
  const made = await app.call('POST', ws('/devices'), admin, { name, locationId });
  const paired = await app.call('POST', '/device/pair', '', { code: (made.body!.pairing as { code: string }).code, model: 'cyd-28-st7789', version });
  return { id: made.body!.id as string, token: paired.body!.token as string };
}

beforeAll(async () => {
  app = await startApp();
  workspaceId = (await prisma.workspace.create({ data: { name: 'Finds' } })).id;
  typeId = (
    await prisma.itemType.create({
      data: { workspaceId, name: 'Filament', fields: { create: [
        { key: 'material', label: 'Material', fieldType: 'text', options: [] },
        { key: 'colour', label: 'Colour', fieldType: 'color', options: [] },
      ] } },
    })
  ).id;
  gramsId = (await prisma.unit.create({ data: { workspaceId, name: 'Grams', symbol: 'g', decimals: 0 } })).id;
  rack = (await prisma.location.create({ data: { workspaceId, name: 'Rack' } })).id;
  shelf = (await prisma.location.create({ data: { workspaceId, name: 'Shelf', parentId: rack } })).id;
  drawer = (await prisma.location.create({ data: { workspaceId, name: 'Drawer' } })).id;
  admin = await member('admin@finds.test', workspaceId, 'admin');
  operator = await member('operator@finds.test', workspaceId, 'operator');
  viewer = await member('viewer@finds.test', workspaceId, 'viewer');
  rackToken = (await display('Rack display', rack, '0.3.2')).token;
  const onShelf = await display('Shelf display', shelf, '0.4.0');
  shelfToken = onShelf.token;
  shelfDisplayId = onShelf.id;
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('finding a spool', () => {
  it('lights the display nearest to where it is kept, and only that one', async () => {
    const green = await spool('PLA Green', { locationId: shelf });
    const before = await overview(shelfToken);
    expect(before.find).toBeUndefined();

    const found = await find(green.id);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ state: 'lit', place: 'Rack / Shelf', displays: [{ name: 'Shelf display', online: true, outdated: false }] });
    expect(Number(found.body?.expiresAt)).toBeGreaterThan(Date.now() + FIND_MS - 5000);

    // A display that already has everything else still hears of it: the find is part of what `v` is made from.
    const after = await app.call('GET', `/device/overview?since=${before.v}`, shelfToken);
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ find: { row: { id: green.id, name: 'PLA Green', at: null } } });
    // The rack's display shows the shelf's items too, but the shelf has a display of its own.
    expect(await lit(rackToken)).toBeNull();
    // It is sent whatever location the display is browsing.
    expect((await overview(shelfToken, `?location=${drawer}`)).find?.row.id).toBe(green.id);

    const log = await prisma.activityLog.findFirstOrThrow({ where: { workspaceId, entityId: green.id }, orderBy: { createdAt: 'desc' } });
    expect([log.userName, log.summary]).toEqual(['operator', 'Looked for PLA Green on Shelf display']);
    await app.call('DELETE', ws(`/items/${green.id}/find`), operator);
  });

  it('uses the display of the location it sits inside when its own has none, and says when that firmware is too old', async () => {
    const blue = await spool('PLA Blue', { locationId: rack });
    expect((await find(blue.id)).body).toMatchObject({ state: 'lit', place: 'Rack', displays: [{ name: 'Rack display', online: true, outdated: true }] });
    expect(await lit(rackToken)).toBe('PLA Blue');
    expect(await lit(shelfToken)).toBeNull();
    await app.call('DELETE', ws(`/items/${blue.id}/find`), operator);
    expect(await lit(rackToken)).toBeNull();
  });

  it('says where it is when no display can light it', async () => {
    const inDrawer = await spool('PLA Drawer', { locationId: drawer });
    expect((await find(inDrawer.id)).body).toEqual({ state: 'no-display', place: 'Drawer', displays: [], expiresAt: null });
    const out = await spool('PLA Out', { outSince: new Date() });
    expect((await find(out.id)).body).toEqual({ state: 'on-the-move', place: null, displays: [], expiresAt: null });
    const nowhere = await spool('PLA Nowhere');
    expect((await find(nowhere.id)).body).toMatchObject({ state: 'nowhere', place: null });

    const loaded = await spool('PLA Loaded', { locationId: shelf });
    const machine = await prisma.machine.create({ data: { workspaceId, name: 'X1C' } });
    const ams = await prisma.subUnit.create({ data: { workspaceId, machineId: machine.id, name: 'AMS 1', readings: [] } });
    await prisma.slot.create({ data: { subUnitId: ams.id, position: 2, itemId: loaded.id } });
    expect((await find(loaded.id)).body).toEqual({ state: 'loaded', place: 'X1C, AMS 1 slot 2', displays: [], expiresAt: null });
    expect(await lit(shelfToken)).toBeNull();
    expect((await find('nope')).status).toBe(404);
  });

  it('says when its display is not reporting, and lights it once it is back', async () => {
    const grey = await spool('PLA Grey', { locationId: shelf });
    await prisma.device.update({ where: { id: shelfDisplayId }, data: { lastSeenAt: new Date(Date.now() - 60 * 60_000) } });
    expect((await find(grey.id)).body).toMatchObject({ state: 'offline', place: 'Rack / Shelf', displays: [{ name: 'Shelf display', online: false }] });
    expect(await lit(shelfToken)).toBe('PLA Grey');
    await app.call('DELETE', ws(`/items/${grey.id}/find`), operator);
  });

  it('is for operators, not viewers', async () => {
    const red = await spool('PLA Red', { locationId: shelf });
    expect((await find(red.id, viewer)).status).toBe(403);
    expect((await app.call('POST', ws(`/items/${red.id}/take-out`), viewer)).status).toBe(403);
    expect(await lit(shelfToken)).toBeNull();
    expect((await find(red.id, operator)).status).toBe(200);
    expect((await app.call('DELETE', ws(`/items/${red.id}/find`), operator)).status).toBe(204);
    expect(await lit(shelfToken)).toBeNull();
  });

  it('stops after two minutes', async () => {
    const white = await spool('PLA White', { locationId: shelf });
    await find(white.id);
    expect(await lit(shelfToken)).toBe('PLA White');
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + FIND_MS + 1);
    expect(await lit(shelfToken)).toBeNull();
  });

  it('stops by itself when the spool is put away somewhere else, retired or loaded into a machine', async () => {
    const moved = await spool('PLA Moved', { locationId: shelf });
    await find(moved.id);
    expect(await lit(shelfToken)).toBe('PLA Moved');
    await app.call('POST', ws('/items/move'), operator, { itemIds: [moved.id], locationId: drawer });
    expect(await lit(shelfToken)).toBeNull();

    const retired = await spool('PLA Retired', { locationId: shelf });
    await find(retired.id);
    expect(await lit(shelfToken)).toBe('PLA Retired');
    await prisma.item.update({ where: { id: retired.id }, data: { archived: true } });
    expect(await lit(shelfToken)).toBeNull();

    const loading = await spool('PLA Loading', { locationId: shelf });
    await find(loading.id);
    const ams = await prisma.subUnit.findFirstOrThrow({ where: { workspaceId, name: 'AMS 1' } });
    await prisma.slot.create({ data: { subUnitId: ams.id, position: 3, itemId: loading.id } });
    expect(await lit(shelfToken)).toBeNull();
  });
});

describe('taking a spool out', () => {
  it('from the app: it is on the move, and its display stops lighting it', async () => {
    const black = await spool('PLA Black', { locationId: shelf });
    await find(black.id);
    const taken = await app.call('POST', ws(`/items/${black.id}/take-out`), operator);
    expect(taken.status).toBe(200);
    expect(taken.body).toMatchObject({ id: black.id, locationId: null });
    expect((await itemNow(black.id)).outSince).not.toBeNull();
    expect(await lit(shelfToken)).toBeNull();
    const log = await prisma.activityLog.findFirstOrThrow({ where: { workspaceId, entityId: black.id }, orderBy: { createdAt: 'desc' } });
    expect([log.userName, log.summary]).toEqual(['operator', 'Took PLA Black out of Shelf: it is on the move']);

    const again = await app.call('POST', ws(`/items/${black.id}/take-out`), operator);
    expect(again.status).toBe(409);
    expect(String(again.body?.error)).toBe('PLA Black is already on the move');
    const loaded = await prisma.item.findFirstOrThrow({ where: { workspaceId, name: 'PLA Loaded' } });
    const refused = await app.call('POST', ws(`/items/${loaded.id}/take-out`), operator);
    expect(refused.status).toBe(409);
    expect(String(refused.body?.error)).toBe('PLA Loaded is loaded in AMS 1 slot 2. Unload it first.');
    expect((await itemNow(loaded.id)).locationId).toBe(shelf);
  });

  it('by touching the lit row on the display, and only the spool it is lit for', async () => {
    const orange = await spool('PLA Orange', { locationId: shelf });
    const other = await spool('PLA Other', { locationId: shelf });
    expect((await app.call('POST', `/device/item/${orange.id}/take-out`, shelfToken)).status).toBe(409);
    await find(orange.id);
    expect((await app.call('POST', `/device/item/${other.id}/take-out`, shelfToken)).status).toBe(409);
    expect((await app.call('POST', `/device/item/${orange.id}/take-out`, rackToken)).status).toBe(409);
    expect((await itemNow(orange.id)).locationId).toBe(shelf);

    const taken = await app.call('POST', `/device/item/${orange.id}/take-out`, shelfToken);
    expect(taken.body).toEqual({ ok: true, message: 'Taken out: on the move' });
    expect(await itemNow(orange.id)).toMatchObject({ locationId: null });
    expect((await itemNow(orange.id)).outSince).not.toBeNull();
    expect(await lit(shelfToken)).toBeNull();
    const log = await prisma.activityLog.findFirstOrThrow({ where: { workspaceId, entityId: orange.id }, orderBy: { createdAt: 'desc' } });
    expect([log.userName, log.summary]).toEqual(['Shelf display', 'Took PLA Orange out of Shelf: it is on the move']);
  });

  it('not from a display with changes switched off', async () => {
    const pink = await spool('PLA Pink', { locationId: shelf });
    await find(pink.id);
    await app.call('PATCH', ws(`/devices/${shelfDisplayId}`), admin, { canWrite: false });
    expect((await app.call('POST', `/device/item/${pink.id}/take-out`, shelfToken)).status).toBe(403);
    expect(await lit(shelfToken)).toBe('PLA Pink');
    await app.call('PATCH', ws(`/devices/${shelfDisplayId}`), admin, { canWrite: true });
    await app.call('DELETE', ws(`/items/${pink.id}/find`), operator);
  });

  it('lights one spool at a time on a display, the one asked for last, then the one before', async () => {
    const first = await spool('PLA First', { locationId: shelf, tagId: 'NFC04CCCCCCCCCCCC' });
    const second = await spool('PLA Second', { locationId: shelf, tagId: 'NFC04DDDDDDDDDDDD' });
    await find(first.id);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    await find(second.id);
    expect(await lit(shelfToken)).toBe('PLA Second');
    // The first was asked for too, so taking it out is no mistake, though the display is lit for the second.
    const tapped = await app.call('POST', '/device/tag/04CCCCCCCCCCCC/tap', shelfToken, {});
    expect(tapped.body).toMatchObject({ known: true, message: 'Taken out: on the move' });
    expect(await lit(shelfToken)).toBe('PLA Second');
    await find(first.id);
    await app.call('POST', ws('/items/move'), operator, { itemIds: [first.id], locationId: shelf });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
    await find(first.id);
    expect(await lit(shelfToken)).toBe('PLA First');
    expect((await app.call('POST', `/device/item/${first.id}/take-out`, shelfToken)).status).toBe(200);
    expect(await lit(shelfToken)).toBe('PLA Second');
    await app.call('DELETE', ws(`/items/${second.id}/find`), operator);
  });

  it('a tap at the reader says when it took out a different spool than the one asked for', async () => {
    const asked = await spool('PLA Asked', { locationId: shelf, tagId: 'NFC04AAAAAAAAAAAA' });
    const wrong = await spool('PLA Wrong', { locationId: shelf, tagId: 'NFC04BBBBBBBBBBBB' });
    await find(asked.id);
    const tapped = await app.call('POST', '/device/tag/04BBBBBBBBBBBB/tap', shelfToken, {});
    expect(tapped.body).toMatchObject({ known: true, message: 'Taken out. Not the one asked for: PLA Asked' });
    expect((await itemNow(wrong.id)).outSince).not.toBeNull();
    expect(await lit(shelfToken)).toBe('PLA Asked');

    const right = await app.call('POST', '/device/tag/04AAAAAAAAAAAA/tap', shelfToken, {});
    expect(right.body).toMatchObject({ known: true, message: 'Taken out: on the move' });
    expect(await lit(shelfToken)).toBeNull();
  });
});
