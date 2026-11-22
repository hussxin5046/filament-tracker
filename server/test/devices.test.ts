import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simDocument, simFleet } from '@filament-tracker/protocol/fixtures';
import { prisma } from '@/db';
import { bridgeConnected, ingestReport, resetRegistry, setLinkStatus, trackPrinterById, writesSettled } from '@/integrations/registry';
import { displayPrinter, forDisplay } from '@/services/deviceOverview';
import { emptyReading } from '@/integrations/types';
import { member, startApp } from './http';

/**
 * Location displays: set-up codes, the display's own token, the overview it draws, and tapping tags on its reader.
 * Every call here comes from one address, and pairing allows 10 tries in 10 minutes, so pairs are counted.
 */

type App = Awaited<ReturnType<typeof startApp>>;
let app: App;
let workspaceId: string;
let otherWorkspaceId: string;
let admin: string;
let operator: string;
let viewer: string;
let typeId: string;
let gramsId: string;
const loc: Record<string, string> = {};

const ws = (path: string) => `/workspaces/${workspaceId}${path}`;
const item = (name: string, data: Record<string, unknown> = {}) =>
  prisma.item.create({ data: { workspaceId, itemTypeId: typeId, unitId: gramsId, name, quantity: 750, capacity: 1000, fields: { material: 'PLA', brand: 'Bambu Lab', colour: '#1A1A1A' }, ...data } });

async function addDisplay(name: string, locationId: string | null = loc.rack) {
  const created = await app.call('POST', ws('/devices'), admin, { name, locationId });
  expect(created.status).toBe(201);
  return created.body as { id: string; pairing: { code: string; server: string; expiresAt: string } };
}

async function pair(code: string) {
  return app.call('POST', '/device/pair', '', { code, model: 'cyd-28-st7789+pn532', version: '0.1.0' });
}

beforeAll(async () => {
  app = await startApp();
  const workspace = await prisma.workspace.create({ data: { name: 'Shop' } });
  workspaceId = workspace.id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: 'Other' } })).id;
  admin = await member('admin@example.test', workspaceId, 'admin');
  operator = await member('operator@example.test', workspaceId, 'operator');
  viewer = await member('viewer@example.test', workspaceId, 'viewer');
  typeId = (
    await prisma.itemType.create({
      data: { workspaceId, name: 'Filament', fields: { create: [
        { key: 'material', label: 'Material', fieldType: 'text', options: [] },
        { key: 'colour', label: 'Colour', fieldType: 'color', options: [] },
        { key: 'brand', label: 'Brand', fieldType: 'text', options: [] },
      ] } },
    })
  ).id;
  gramsId = (await prisma.unit.create({ data: { workspaceId, name: 'Grams', symbol: 'g', decimals: 0 } })).id;
  loc.workshop = (await prisma.location.create({ data: { workspaceId, name: 'Workshop' } })).id;
  loc.rack = (await prisma.location.create({ data: { workspaceId, name: 'Rack A', parentId: loc.workshop } })).id;
  loc.shelf = (await prisma.location.create({ data: { workspaceId, name: 'Shelf 2', parentId: loc.rack } })).id;
  loc.bin = (await prisma.location.create({ data: { workspaceId, name: 'Bin' } })).id;
  loc.elsewhere = (await prisma.location.create({ data: { workspaceId: otherWorkspaceId, name: 'Not yours' } })).id;
});

afterAll(async () => {
  resetRegistry();
  await app.close();
  await prisma.$disconnect();
});

describe('managing displays in Settings', () => {
  it('lets members look, and only admins add, change or remove', async () => {
    expect((await app.call('GET', ws('/devices'), viewer)).status).toBe(200);
    expect((await app.call('POST', ws('/devices'), viewer, { name: 'X' })).status).toBe(403);
    expect((await app.call('POST', ws('/devices'), operator, { name: 'X' })).status).toBe(403);
    expect((await app.call('POST', ws('/devices'), admin, { name: 'X', locationId: loc.elsewhere })).status).toBe(400);
    const created = await addDisplay('Spare');
    expect(created.pairing.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(created.pairing.server).toMatch(/^https?:\/\//);
    expect((await app.call('PATCH', ws(`/devices/${created.id}`), operator, { name: 'Y' })).status).toBe(403);
    expect((await app.call('PATCH', ws(`/devices/${created.id}`), admin, { machineId: 'nope' })).status).toBe(400);
    const renamed = await app.call('PATCH', ws(`/devices/${created.id}`), admin, { name: 'Renamed', canWrite: false });
    expect(renamed.body).toMatchObject({ name: 'Renamed', canWrite: false, paired: false, online: false });
    expect((await app.call('DELETE', ws(`/devices/${created.id}`), operator)).status).toBe(403);
    expect((await app.call('DELETE', ws(`/devices/${created.id}`), admin)).status).toBe(204);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { workspaceId, action: 'device.delete' } });
    expect(log.summary).toBe('Deleted display Renamed');
  });

  it('stops at the per-workspace limit', async () => {
    const made = [];
    for (let i = 0; i < 5; i += 1) made.push(await addDisplay(`D${i}`));
    expect((await app.call('POST', ws('/devices'), admin, { name: 'One too many' })).status).toBe(409);
    for (const device of made) await prisma.device.delete({ where: { id: device.id } });
  });
});

describe('pairing and the display token', () => {
  let token = '';
  let deviceId = '';

  it('swaps a code for a token once, and refuses an expired code', async () => {
    const created = await addDisplay('Rack display');
    deviceId = created.id;
    const paired = await pair(created.pairing.code.toLowerCase());
    expect(paired.status).toBe(200);
    expect(paired.body).toMatchObject({ deviceId, workspaceName: 'Shop', deviceName: 'Rack display' });
    token = String(paired.body?.token);
    expect(token).toMatch(/^wbd_/);
    expect((await pair(created.pairing.code)).status).toBe(400);

    const late = await addDisplay('Late');
    await prisma.device.update({ where: { id: late.id }, data: { pairingExpiresAt: new Date(Date.now() - 1000) } });
    expect((await pair(late.pairing.code)).status).toBe(400);
    await prisma.device.delete({ where: { id: late.id } });

    const list = await app.call('GET', ws('/devices'), viewer);
    expect((list.body as unknown as Array<Record<string, unknown>>)[0]).toMatchObject({ id: deviceId, paired: true, online: true, model: 'cyd-28-st7789+pn532', locationName: 'Rack A' });
    expect(await prisma.activityLog.count({ where: { workspaceId, action: 'device.pair', userName: 'Rack display' } })).toBe(1);
  });

  it('refuses no token, a member sign-in and a bridge token', async () => {
    expect((await app.call('GET', '/device/overview', '')).status).toBe(401);
    expect((await app.call('GET', '/device/overview', admin)).status).toBe(401);
    expect((await app.call('GET', '/device/overview', 'wbb_madeup')).status).toBe(401);
    expect((await app.call('GET', ws('/devices'), token)).status).toBe(401);
  });

  it('shows the location and the ones inside it, low stock first, without archived items', async () => {
    await item('PLA White', { locationId: loc.rack });
    await item('PETG Black', { locationId: loc.shelf, fields: { material: 'PETG', colour: 'not a colour' } });
    await item('ABS Low', { locationId: loc.rack, quantity: 50, minQuantity: 200 });
    await item('Old spool', { locationId: loc.rack, archived: true });
    await item('Elsewhere', { locationId: loc.bin });
    await item('Café crème', { locationId: loc.rack, capacity: null });

    const { status, body } = await app.call('GET', '/device/overview?nfc=1', token);
    expect(status).toBe(200);
    expect(body).toMatchObject({ workspace: 'Shop', device: 'Rack display', canWrite: true, total: 4, lowCount: 1, poll: 30 });
    expect(body?.location).toEqual({ id: loc.rack, name: 'Rack A', path: 'Workshop / Rack A' });
    const rows = body?.items as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.name)).toEqual(['ABS Low', 'Cafe creme', 'PETG Black', 'PLA White']);
    expect(rows[0]).toMatchObject({ low: true, qty: '50 g', fill: 0.05, sub: 'PLA - Bambu Lab', color: '#1a1a1a', at: null });
    expect(rows[1]).toMatchObject({ fill: null });
    expect(rows[2]).toMatchObject({ at: 'Shelf 2', color: null, sub: 'PETG' });
    expect((body?.locations as Array<{ name: string }>).map((l) => l.name)).toContain('Workshop / Rack A / Shelf 2');
    expect((await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).hasReader).toBe(true);
  });

  it('answers 304 while nothing changed, and a new version after a stock change', async () => {
    const first = await app.call('GET', '/device/overview', token);
    const v = String(first.body?.v);
    expect((await app.call('GET', `/device/overview?since=${v}`, token)).status).toBe(304);
    await prisma.item.updateMany({ where: { workspaceId, name: 'PLA White' }, data: { quantity: 300 } });
    const next = await app.call('GET', `/device/overview?since=${v}`, token);
    expect(next.status).toBe(200);
    expect(next.body?.v).not.toBe(v);
  });

  it('browses another location of its own workspace, at most 40 rows, but not another workspace', async () => {
    for (let i = 0; i < 45; i += 1) await item(`Bulk ${String(i).padStart(2, '0')}`, { locationId: loc.bin });
    const bin = await app.call('GET', `/device/overview?location=${loc.bin}`, token);
    expect(bin.body).toMatchObject({ total: 46 });
    expect((bin.body?.items as unknown[]).length).toBe(40);
    expect((await app.call('GET', `/device/overview?location=${loc.elsewhere}`, token)).status).toBe(404);
  });

  it('shows nothing when it has no location', async () => {
    await prisma.device.update({ where: { id: deviceId }, data: { locationId: null } });
    const { body } = await app.call('GET', '/device/overview', token);
    expect(body).toMatchObject({ location: null, total: 0, items: [] });
    await prisma.device.update({ where: { id: deviceId }, data: { locationId: loc.rack } });
  });

  it('stops the old token when set up again, and every token when removed', async () => {
    const fresh = await app.call('POST', ws(`/devices/${deviceId}/pairing`), admin);
    const repaired = await pair(String((fresh.body?.pairing as { code: string }).code));
    expect(repaired.status).toBe(200);
    expect((await app.call('GET', '/device/overview', token)).status).toBe(401);
    const newToken = String(repaired.body?.token);
    expect((await app.call('GET', '/device/overview', newToken)).status).toBe(200);
    expect((await app.call('DELETE', ws(`/devices/${deviceId}`), admin)).status).toBe(204);
    expect((await app.call('GET', '/device/overview', newToken)).status).toBe(401);
  });
});

describe('tapping a tag on the display', () => {
  let token = '';
  let deviceId = '';
  let machineId = '';

  beforeAll(async () => {
    const created = await addDisplay('Dry box');
    deviceId = created.id;
    token = String((await pair(created.pairing.code)).body?.token);
  });

  it('finds a sticker by its UID, a hand-typed bare UID, and nothing for an unknown tag', async () => {
    await item('Sticker spool', { locationId: loc.bin, tagId: 'NFC04A1B2C3D4E5F6' });
    await item('Typed tag', { locationId: loc.rack, tagId: 'DEADBEEF' });
    await item('Printer tagged', { locationId: loc.bin, tagId: '0123456789ABCDEF0123456789ABCDEF' });

    const sticker = await app.call('GET', '/device/tag/04:a1:b2:c3:d4:e5:f6', token);
    expect(sticker.body).toMatchObject({ known: true, uid: '04A1B2C3D4E5F6', canPutAway: true, insertInto: null });
    expect(sticker.body?.item).toMatchObject({ name: 'Sticker spool', location: 'Bin', here: false, tagged: true });

    const typed = await app.call('GET', '/device/tag/deadbeef', token);
    expect(typed.body).toMatchObject({ known: true, canPutAway: false, item: { name: 'Typed tag', here: true } });

    expect((await app.call('GET', '/device/tag/11223344', token)).body).toEqual({ known: false, uid: '11223344', canLink: true });
    expect((await app.call('GET', '/device/tag/xyz', token)).status).toBe(400);
  });

  it('puts a spool away here and logs it under the display', async () => {
    const moved = await app.call('POST', '/device/tag/04A1B2C3D4E5F6/put-away', token);
    expect(moved.body).toMatchObject({ moved: 1, message: 'Moved Sticker spool to Rack A' });
    expect((await prisma.item.findFirstOrThrow({ where: { name: 'Sticker spool' } })).locationId).toBe(loc.rack);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { workspaceId, action: 'item.move' }, orderBy: { createdAt: 'desc' } });
    expect(log).toMatchObject({ userId: null, userName: 'Dry box', summary: 'Moved Sticker spool to Rack A' });
    expect((await app.call('POST', '/device/tag/04A1B2C3D4E5F6/put-away', token)).body).toMatchObject({ moved: 0 });
    expect((await app.call('POST', '/device/tag/99999999/put-away', token)).status).toBe(404);
  });

  it('links a new sticker to an item here, but not to another workspace\'s item or a printer-tagged spool', async () => {
    const untagged = await item('Needs a tag', { locationId: loc.shelf });
    const list = await app.call('GET', '/device/untagged', token);
    expect((list.body?.items as Array<{ name: string }>).map((row) => row.name)).toContain('Needs a tag');
    expect((list.body?.items as Array<{ name: string }>).map((row) => row.name)).not.toContain('Typed tag');

    const linked = await app.call('POST', '/device/tag/11223344/link', token, { itemId: untagged.id });
    expect(linked.status).toBe(200);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: untagged.id } })).tagId).toBe('NFC11223344');
    expect((await app.call('GET', '/device/tag/11223344', token)).body).toMatchObject({ known: true, item: { name: 'Needs a tag' } });

    const theirs = await prisma.item.create({ data: { workspaceId: otherWorkspaceId, itemTypeId: (await prisma.itemType.create({ data: { workspaceId: otherWorkspaceId, name: 'T' } })).id, name: 'Theirs', fields: {} } });
    expect((await app.call('POST', '/device/tag/55667788/link', token, { itemId: theirs.id })).status).toBe(404);
    // An item kept somewhere else is not this display's to tag; one kept here that has a printer's own tag keeps it.
    const printerTagged = await prisma.item.findFirstOrThrow({ where: { name: 'Printer tagged' } });
    if (printerTagged.locationId !== loc.rack) expect((await app.call('POST', '/device/tag/55667788/link', token, { itemId: printerTagged.id })).status).toBe(403);
    await prisma.item.update({ where: { id: printerTagged.id }, data: { locationId: loc.rack } });
    expect((await app.call('POST', '/device/tag/55667788/link', token, { itemId: printerTagged.id })).status).toBe(409);
    await prisma.item.update({ where: { id: printerTagged.id }, data: { locationId: printerTagged.locationId } });
  });

  it('marks a spool for the printer beside it only while that printer is reporting', async () => {
    const printer = simFleet()[0];
    machineId = (await prisma.machine.create({ data: { workspaceId, name: 'X1C' } })).id;
    expect((await app.call('POST', '/device/tag/11223344/insert', token)).status).toBe(409);
    await app.call('PATCH', ws(`/devices/${deviceId}`), admin, { machineId });
    expect((await app.call('GET', '/device/tag/11223344', token)).body).toMatchObject({ insertInto: { machineId, name: 'X1C' } });

    const bridge = await prisma.bridge.create({ data: { workspaceId, name: 'B', capabilities: [] } });
    const link = await prisma.printerLink.create({ data: { workspaceId, machineId, bridgeId: bridge.id, serial: printer.serial, host: '192.168.1.9' } });
    await trackPrinterById(link.id);
    const silent = await app.call('POST', '/device/tag/11223344/insert', token);
    expect(silent.status).toBe(409);
    expect(String(silent.body?.error)).toContain('X1C is not reporting');

    bridgeConnected(bridge.id);
    setLinkStatus(bridge.id, { printerId: link.id, link: 'online', codeState: 'ok' });
    ingestReport(bridge.id, { printerId: link.id, seq: 0, kind: 'full', data: simDocument(printer) });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await writesSettled();
    const armed = await app.call('POST', '/device/tag/11223344/insert', token);
    expect(armed.status).toBe(200);
    expect(Number(armed.body?.expiresAt)).toBeGreaterThan(Date.now() + 100_000);
    expect(await prisma.activityLog.count({ where: { workspaceId, userName: 'Dry box', summary: 'Tapped Needs a tag to go into X1C next' } })).toBe(1);
  });

  it('shows the status of the printer beside it, and polls faster while it prints', async () => {
    // The simulated X1C is printing bracket_v3: 37 %, 94 minutes left, layer 112 of 300, AMS 1 slot 1 feeding.
    const { body } = await app.call('GET', '/device/overview', token);
    expect(body?.poll).toBe(15);
    const printer = body?.printer as Record<string, unknown>;
    expect(printer).toMatchObject({
      name: 'X1C', state: 'Printing', tone: 'busy', progress: 0.37, left: '1 h 34 min left', job: 'bracket_v3', layer: 'Layer 112 of 300',
    });
    const trays = printer.trays as Array<Record<string, unknown>>;
    expect(trays[0]).toMatchObject({ label: 'A1', material: 'PLA', color: '#000000', active: true, empty: false });
    expect(trays[3]).toMatchObject({ label: 'A4', empty: true, color: null });
    expect(trays.find((t) => t.label === 'B1')).toMatchObject({ material: 'PLA', color: '#c12e1f' });
    expect(trays.length).toBeLessThanOrEqual(8);
  });

  it('shows the spool Wrkbench has in a slot rather than what the printer last set there', async () => {
    // The printer reports A2 as black PLA; the spool linked to that slot in Wrkbench is white PETG.
    const unit = await prisma.subUnit.findFirstOrThrow({ where: { workspaceId, externalId: { endsWith: ':ams:0' } } });
    const spool = await item('White PETG', { fields: { material: 'PETG', brand: 'Other', colour: '#FFFFFF' } });
    await prisma.slot.upsert({
      where: { subUnitId_position: { subUnitId: unit.id, position: 2 } },
      create: { subUnitId: unit.id, position: 2, itemId: spool.id },
      update: { itemId: spool.id },
    });
    const trays = ((await app.call('GET', '/device/overview', token)).body?.printer as { trays: Array<Record<string, unknown>> }).trays;
    expect(trays[1]).toMatchObject({ label: 'A2', material: 'PETG', color: '#ffffff' });
    // Slots without a linked spool still show what the printer reports.
    expect(trays[0]).toMatchObject({ label: 'A1', material: 'PLA', color: '#000000' });
    await prisma.slot.update({ where: { subUnitId_position: { subUnitId: unit.id, position: 2 } }, data: { itemId: null } });
    await prisma.item.delete({ where: { id: spool.id } });
  });

  it('refuses every change when changes from the display are switched off', async () => {
    await app.call('PATCH', ws(`/devices/${deviceId}`), admin, { canWrite: false });
    expect((await app.call('GET', '/device/tag/04A1B2C3D4E5F6', token)).body).toMatchObject({ canPutAway: false, insertInto: null });
    const spare = await item('Spare', { locationId: loc.rack });
    expect((await app.call('POST', '/device/tag/04A1B2C3D4E5F6/put-away', token)).status).toBe(403);
    expect((await app.call('POST', '/device/tag/11223344/insert', token)).status).toBe(403);
    expect((await app.call('POST', '/device/tag/AABBCCDD/link', token, { itemId: spare.id })).status).toBe(403);
    expect((await app.call('GET', '/device/overview', token)).body).toMatchObject({ canWrite: false });
  });
});

describe('printer status for the display', () => {
  it('says when a printer is not connected or not reporting', () => {
    expect(displayPrinter('Laser', null)).toMatchObject({ name: 'Laser', state: 'Not connected', tone: 'off', trays: [] });
    const reading = { ...emptyReading(), phase: 'idle' as const };
    const offline = displayPrinter('X1C', { ...reading, v: 1, machineId: 'm', printerLinkId: 'l', connection: 'bridge_offline', asOf: 1, endsAt: null, thumbnailRunId: null });
    expect(offline).toMatchObject({ state: 'Bridge offline', tone: 'off', progress: null });
    const fault = displayPrinter('X1C', {
      ...reading, phase: 'printing', v: 1, machineId: 'm', printerLinkId: 'l', connection: 'live', asOf: 1, endsAt: null, thumbnailRunId: null,
      print: { name: 'part', kind: 'print', progress: 50, layer: null, totalLayers: null, remainingMinutes: 45 },
      errors: [{ kind: 'hms', code: '0700_8011', severity: 'error', message: 'AMS filament ran out.', url: null }],
    });
    expect(fault).toMatchObject({ state: 'Printing', tone: 'error', progress: 0.5, left: '45 min left', error: 'AMS filament ran out.' });
  });

  it('shows the nozzle printing now on a dual-nozzle printer', () => {
    const nozzle = { diameter: 0.4, type: null };
    const live = { ...emptyReading(), phase: 'printing' as const, v: 1 as const, machineId: 'm', printerLinkId: 'l', connection: 'live' as const, asOf: 1, endsAt: null, thumbnailRunId: null };
    const right = { label: 'Right nozzle', temp: { current: 30, target: 0 }, nozzle };
    const left = { label: 'Left nozzle', temp: { current: 219, target: 220 }, nozzle };
    const printing = displayPrinter('X2D', { ...live, extruders: [{ ...right, active: false }, { ...left, active: true }] });
    expect(printing.temps).toMatch(/^Nozzle 219\/220 C/);
    // A reading saved before nozzles had `active`: the one heating is shown.
    const older = displayPrinter('X2D', { ...live, extruders: [right, left] as unknown as typeof live.extruders });
    expect(older.temps).toMatch(/^Nozzle 219\/220 C/);
    // Both cold: the first, as before.
    const idle = displayPrinter('X2D', { ...live, extruders: [{ ...right, active: false }, { ...left, temp: { current: 28, target: 0 }, active: false }] });
    expect(idle.temps).toMatch(/^Nozzle 30 C/);
  });
});

describe('wording for the display', () => {
  it('keeps to plain ASCII and a set length', () => {
    expect(forDisplay('Señor Ünïcode')).toBe('Senor Unicode');
    expect(forDisplay('PLA • Matte')).toBe('PLA Matte');
    expect(forDisplay('x'.repeat(50), 10)).toBe('xxxxxxxxx~');
  });
});
