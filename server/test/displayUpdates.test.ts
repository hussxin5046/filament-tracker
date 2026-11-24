import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/db';
import { compareVersions, resetFirmwareCache } from '@/services/firmware';
import { member, startApp } from './http';

/**
 * Updating a display's firmware from Settings: what its card says, asking for an update, the display picking
 * it up on its next poll and fetching the file once, and how an update that never finishes is reported.
 */

type App = Awaited<ReturnType<typeof startApp>>;
let app: App;
let workspaceId: string;
let admin: string;
let operator: string;
const dir = process.env.FIRMWARE_DIR!;
const ws = (p: string) => `/workspaces/${workspaceId}${p}`;

/** Publishes a build for the 2.8" ST7789 board into the test's firmware folder, as the release workflow would. */
function publish(version: string, options: { corrupt?: boolean; keepCache?: boolean } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const app = randomBytes(4096);
  const file = `wrkbench-display-${version}-cyd-28-st7789.bin`;
  writeFileSync(path.join(dir, file), options.corrupt ? randomBytes(4096) : app);
  const full = randomBytes(8192);
  const fullFile = `wrkbench-display-${version}-cyd-28-st7789-full.bin`;
  writeFileSync(path.join(dir, fullFile), full);
  const manifest = {
    version,
    builds: [
      {
        model: 'cyd-28-st7789',
        name: '2.8 inch, ST7789 screen',
        app: { file, size: app.length, sha256: createHash('sha256').update(app).digest('hex'), md5: createHash('md5').update(app).digest('hex') },
        full: { file: fullFile, size: full.length, sha256: createHash('sha256').update(full).digest('hex') },
      },
    ],
  };
  writeFileSync(path.join(dir, 'firmware-manifest.json'), JSON.stringify(manifest));
  // keepCache: published while the server still has the last lookup, as a new release on GitHub is.
  if (!options.keepCache) resetFirmwareCache();
  return { bytes: app, md5: manifest.builds[0].app.md5, full };
}

/** A display set up with this model and firmware; returns its id and token. */
async function display(name: string, model: string, version: string) {
  const created = await app.call('POST', ws('/devices'), admin, { name });
  const code = (created.body as { pairing: { code: string } }).pairing.code;
  const paired = await app.call('POST', '/device/pair', '', { code, model, version });
  return { id: (created.body as { id: string }).id, token: (paired.body as { token: string }).token };
}

const card = async (id: string) => {
  const list = (await app.call('GET', ws('/devices'), admin)).body as unknown as Array<Record<string, unknown>>;
  return list.find((d) => d.id === id) as { version: string; updateTo: string | null; updateError: string | null; firmware: { latest: string | null; updateAvailable: boolean; blocked: string | null } };
};

const poll = (token: string, fw: string) => app.call('GET', `/device/overview?nfc=0&fw=${fw}`, token);

beforeAll(async () => {
  app = await startApp();
  workspaceId = (await prisma.workspace.create({ data: { name: 'Shop' } })).id;
  admin = await member('admin@example.test', workspaceId, 'admin');
  operator = await member('operator@example.test', workspaceId, 'operator');
});

afterEach(async () => {
  // A workspace may have five displays; each test sets up its own.
  await prisma.device.deleteMany({ where: { workspaceId } });
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await app.close();
  await prisma.$disconnect();
});

describe('firmware versions', () => {
  it('compares plain version numbers and nothing else', () => {
    expect(compareVersions('0.3.1', '0.3.0')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.3.0', 'dev')).toBeNull();
  });
});

describe('checking for new firmware from Settings', () => {
  it('finds a new release at once for an admin, and looks again at most once a minute', async () => {
    publish('0.3.0');
    const { id } = await display('Rack', 'cyd-28-st7789', '0.3.0');
    expect((await card(id)).firmware.latest).toBe('0.3.0');

    publish('0.4.0', { keepCache: true });
    expect((await card(id)).firmware.latest).toBe('0.3.0');
    expect((await app.call('POST', ws('/firmware/check'), operator, {})).status).toBe(403);
    const checked = await app.call('POST', ws('/firmware/check'), admin, {});
    expect(checked.body).toMatchObject({ version: '0.4.0', reached: true });
    expect((await card(id)).firmware).toMatchObject({ latest: '0.4.0', updateAvailable: true });

    // Pressed again straight away: the last minute's answer, without looking again.
    publish('0.5.0', { keepCache: true });
    expect((await app.call('POST', ws('/firmware/check'), admin, {})).body).toMatchObject({ version: '0.4.0' });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    expect((await app.call('POST', ws('/firmware/check'), admin, {})).body).toMatchObject({ version: '0.5.0' });
    clock.mockRestore();
  });
});

describe('updating a display from Settings', () => {
  it('offers nothing while no firmware is published, without failing', async () => {
    rmSync(dir, { recursive: true, force: true });
    resetFirmwareCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { id } = await display('No builds', 'cyd-28-st7789', '0.3.0');
    expect((await card(id)).firmware).toEqual({ latest: null, updateAvailable: false, blocked: null });
    warn.mockRestore();
  });

  it('updates a display: asked by an admin, offered on its next poll, fetched once, done when it reports the version', async () => {
    const { bytes, md5 } = publish('0.3.1');
    const { id, token } = await display('Rack A display', 'cyd-28-st7789+pn532', '0.3.0');
    expect((await card(id)).firmware).toEqual({ latest: '0.3.1', updateAvailable: true, blocked: null });

    const before = await poll(token, '0.3.0');
    expect(before.body).not.toHaveProperty('update');

    expect((await app.call('POST', ws(`/devices/${id}/update`), operator)).status).toBe(403);
    const asked = await app.call('POST', ws(`/devices/${id}/update`), admin);
    expect(asked.status).toBe(200);
    expect(asked.body).toMatchObject({ updateTo: '0.3.1', updateError: null });

    // The offer changes the overview's version, so a display that had nothing new still gets it.
    const offered = await app.call('GET', `/device/overview?nfc=0&fw=0.3.0&since=${(before.body as { v: string }).v}`, token);
    expect(offered.status).toBe(200);
    expect(offered.body).toMatchObject({ update: { version: '0.3.1', size: bytes.length, md5 } });

    const download = await app.raw('GET', '/device/firmware', token);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).equals(bytes)).toBe(true);
    // Once fetched it is not offered or served again: a build that fails is never retried in a loop.
    expect((await app.raw('GET', '/device/firmware', token)).status).toBe(404);
    expect((await poll(token, '0.3.0')).body).not.toHaveProperty('update');
    expect((await card(id)).updateTo).toBe('0.3.1');

    await poll(token, '0.3.1');
    expect(await card(id)).toMatchObject({ version: '0.3.1', updateTo: null, updateError: null, firmware: { latest: '0.3.1', updateAvailable: false } });
    const log = await prisma.activityLog.findFirst({ where: { workspaceId, action: 'device.update' }, orderBy: { createdAt: 'desc' } });
    expect(log?.summary).toBe('Display Rack A display now runs firmware 0.3.1');
  });

  it('reports an update the display could not install, and one it never came back from', async () => {
    publish('0.3.2');
    const { id, token } = await display('Shelf display', 'cyd-28-st7789', '0.3.0');

    await app.call('POST', ws(`/devices/${id}/update`), admin);
    expect((await app.call('POST', '/device/update-failed', token, { message: 'Download broke off' })).status).toBe(204);
    expect(await card(id)).toMatchObject({ updateTo: null, updateError: 'Download broke off', version: '0.3.0' });

    await app.call('POST', ws(`/devices/${id}/update`), admin);
    expect((await card(id)).updateError).toBeNull();
    expect((await app.raw('GET', '/device/firmware', token)).status).toBe(200);
    await prisma.device.update({ where: { id }, data: { updateStartedAt: new Date(Date.now() - 11 * 60_000) } });
    await poll(token, '0.3.0');
    expect(await card(id)).toMatchObject({ updateTo: null, updateError: 'It went back to firmware 0.3.0' });
  });

  it('can be withdrawn before the display starts it', async () => {
    publish('0.3.3');
    const { id, token } = await display('Dry box display', 'cyd-28-st7789', '0.3.0');
    await app.call('POST', ws(`/devices/${id}/update`), admin);
    expect((await app.call('DELETE', ws(`/devices/${id}/update`), admin)).body).toMatchObject({ updateTo: null });
    expect((await poll(token, '0.3.0')).body).not.toHaveProperty('update');
    expect((await app.raw('GET', '/device/firmware', token)).status).toBe(404);
  });

  it('refuses displays too old to update themselves, other boards, and builds that are already installed', async () => {
    publish('0.3.4');
    const old = await display('Old display', 'cyd-28-st7789', '0.2.0');
    expect((await card(old.id)).firmware).toEqual({ latest: '0.3.4', updateAvailable: true, blocked: 'Flash it from a computer once to get updates from here' });
    expect((await app.call('POST', ws(`/devices/${old.id}/update`), admin)).status).toBe(409);

    const other = await display('Small display', 'cyd-24-st7789', '0.3.0');
    expect((await card(other.id)).firmware).toEqual({ latest: null, updateAvailable: false, blocked: null });
    expect((await app.call('POST', ws(`/devices/${other.id}/update`), admin)).status).toBe(409);

    const current = await display('Current display', 'cyd-28-st7789', '0.3.4');
    expect((await card(current.id)).firmware.updateAvailable).toBe(false);
    expect((await app.call('POST', ws(`/devices/${current.id}/update`), admin)).status).toBe(409);
  });

  it('does not start an update when the published file does not match its checksum', async () => {
    publish('0.3.5', { corrupt: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { id, token } = await display('Checked display', 'cyd-28-st7789', '0.3.0');
    await app.call('POST', ws(`/devices/${id}/update`), admin);
    expect((await app.raw('GET', '/device/firmware', token)).status).toBe(503);
    // Still offered, so it is fetched again once the file is put right.
    expect((await poll(token, '0.3.0')).body).toHaveProperty('update');
    warn.mockRestore();
  });
});

describe('flashing a new display from the browser', () => {
  it('lists the boards of the newest firmware and serves their full images to members', async () => {
    const { full } = publish('0.3.6');
    const viewer = await member('viewer@example.test', workspaceId, 'viewer');
    const list = await app.call('GET', ws('/firmware'), viewer);
    expect(list.body).toEqual({ version: '0.3.6', builds: [{ model: 'cyd-28-st7789', name: '2.8 inch, ST7789 screen', size: full.length }] });

    const image = await app.raw('GET', ws('/firmware/cyd-28-st7789/full'), viewer);
    expect(image.status).toBe(200);
    expect(image.headers.get('x-firmware-version')).toBe('0.3.6');
    expect(Buffer.from(await image.arrayBuffer()).equals(full)).toBe(true);
    expect((await app.raw('GET', ws('/firmware/cyd-99-unknown/full'), viewer)).status).toBe(404);
    expect((await app.raw('GET', ws('/firmware/cyd-28-st7789/full'), '')).status).toBe(401);
  });

  it('lists nothing while no firmware is published', async () => {
    rmSync(dir, { recursive: true, force: true });
    resetFirmwareCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await app.call('GET', ws('/firmware'), admin)).body).toEqual({ version: null, builds: [] });
    warn.mockRestore();
  });
});

describe('finding the newest firmware on GitHub', () => {
  const manifestFor = (version: string) => ({
    version,
    builds: [{ model: 'cyd-28-st7789', name: '2.8 inch', app: { file: `app-${version}.bin`, size: 1, sha256: 'a'.repeat(64), md5: 'b'.repeat(32) } }],
  });
  const release = (tag: string, prerelease: boolean, files: string[]) => ({
    tag_name: tag,
    draft: false,
    prerelease,
    assets: files.map((name) => ({ name, browser_download_url: `https://files.test/${tag}/${name}` })),
  });

  it('takes the newest release whose files are all attached, and skips pre-releases', async () => {
    const releases = [
      // Made on the website a moment ago: its manifest is up, its image not yet.
      release('firmware-v0.3.5', false, ['firmware-manifest.json']),
      release('firmware-v0.3.6-rc1', true, ['firmware-manifest.json', 'app-0.3.6.bin']),
      release('firmware-v0.3.4', false, ['firmware-manifest.json', 'app-0.3.4.bin']),
      release('bridge-v1.2.0', false, []),
    ];
    vi.stubGlobal('fetch', async (url: string) => {
      if (new URL(url).hostname === 'api.github.com') return new Response(JSON.stringify(releases));
      const tag = url.split('/')[3];
      return new Response(JSON.stringify(manifestFor(tag.slice(10).split('-')[0])));
    });
    try {
      const { fromGitHub } = await import('@/services/firmware');
      const found = await fromGitHub('owner/repo');
      expect(found?.manifest.version).toBe('0.3.4');
      expect(found?.locate('app-0.3.4.bin')).toBe('https://files.test/firmware-v0.3.4/app-0.3.4.bin');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
