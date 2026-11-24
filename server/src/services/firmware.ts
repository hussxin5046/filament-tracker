import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { env } from '@/env';

/**
 * Firmware for location displays, so they can be updated from Settings instead of from a computer.
 *
 * Builds are published as a GitHub release tagged `firmware-v<version>` (see .github/workflows/firmware.yml):
 * one app image per kind of board, a full image for flashing a new board from the browser, and
 * `firmware-manifest.json` describing them. The server looks up the newest such release at most once an hour,
 * fetches a file the first time it is needed and keeps it in memory, checked against the manifest's SHA-256.
 * `FIRMWARE_DIR` serves the same manifest and files from a folder instead (self-hosting without GitHub, tests).
 *
 * Nothing here throws to its caller for an outside failure: no release, a slow GitHub or a rate limit all mean
 * "no firmware to offer", never a failed request or start-up.
 */

/** Displays older than this have no updater: they have to be flashed from a computer once. */
export const MIN_UPDATABLE = '0.3.0';

const fileSchema = z.object({
  file: z.string().regex(/^[A-Za-z0-9._-]+$/),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  md5: z.string().regex(/^[0-9a-f]{32}$/).optional(),
});

const manifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  builds: z.array(
    z.object({
      /** What the display reports when it pairs, without extras such as "+pn532": "cyd-28-st7789". */
      model: z.string().min(1),
      /** Shown when flashing a new board: "2.8 inch, ST7789 screen". */
      name: z.string().min(1),
      app: fileSchema.extend({ md5: z.string().regex(/^[0-9a-f]{32}$/) }),
      full: fileSchema.optional(),
    }),
  ),
});

export type FirmwareManifest = z.infer<typeof manifestSchema>;
export type FirmwareBuild = FirmwareManifest['builds'][number];
type FirmwareFile = z.infer<typeof fileSchema>;

interface Catalog {
  manifest: FirmwareManifest;
  /** Where each file is fetched from: a URL, or a path in FIRMWARE_DIR. */
  locate: (file: string) => string | null;
}

const CHECK_MS = 60 * 60_000;
const RETRY_MS = 5 * 60_000;
/** A check asked for from Settings looks again at most this often, so repeated presses never use up GitHub's limit. */
const CHECK_NOW_MS = 60_000;
const TIMEOUT_MS = 20_000;

let cached: { catalog: Catalog | null; until: number } | null = null;
/** When the newest firmware was last looked up, and whether that worked. */
let lastLookup: { at: number; ok: boolean } | null = null;
/** When "Check for new firmware" last made a fresh lookup. */
let lastCheckNow = 0;
let pending: Promise<Catalog | null> | null = null;
const files = new Map<string, Buffer>();

/** "0.3.0" → [0, 3, 0]; null for anything else, such as "dev". */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when a is older than b. Null when either is not a plain version number. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The board part of what a display reports: "cyd-28-st7789+pn532" → "cyd-28-st7789". */
export const boardOf = (model: string) => model.split('+')[0].trim();

async function fetchWithTimeout(url: string, accept: string): Promise<Response> {
  return fetch(url, { headers: { Accept: accept, 'User-Agent': 'wrkbench-server' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
}

async function fromFolder(dir: string): Promise<Catalog> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(dir, 'firmware-manifest.json'), 'utf8')));
  return { manifest, locate: (file) => path.join(dir, file) };
}

const releaseSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    assets: z.array(z.object({ name: z.string(), browser_download_url: z.string() })),
  }),
);

/** Exported for tests: the newest complete firmware release of `repo` on GitHub. */
export async function fromGitHub(repo: string): Promise<{ manifest: FirmwareManifest; locate: (file: string) => string | null } | null> {
  const response = await fetchWithTimeout(`https://api.github.com/repos/${repo}/releases?per_page=30`, 'application/vnd.github+json');
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const releases = releaseSchema.parse(await response.json());
  // Newest first by version, not by date, so a fix released for an older line never hides a newer one.
  const candidates = releases
    .filter((r) => !r.draft && (env.FIRMWARE_PRERELEASES || !r.prerelease) && /^firmware-v\d+\.\d+\.\d+/.test(r.tag_name))
    .sort((a, b) => (compareVersions(b.tag_name.slice(10).split('-')[0], a.tag_name.slice(10).split('-')[0]) ?? 0));
  // The newest release whose files are all there. One made on GitHub's website gets its files a few minutes
  // later from the workflow, manifest first; until then the one before it is offered, never "nothing".
  for (const release of candidates) {
    const urls = new Map(release.assets.map((asset) => [asset.name, asset.browser_download_url]));
    const manifestUrl = urls.get('firmware-manifest.json');
    if (!manifestUrl) continue;
    const manifestResponse = await fetchWithTimeout(manifestUrl, 'application/json');
    if (!manifestResponse.ok) throw new Error(`The firmware manifest answered ${manifestResponse.status}`);
    const manifest = manifestSchema.parse(await manifestResponse.json());
    const complete = manifest.builds.every((b) => urls.has(b.app.file) && (!b.full || urls.has(b.full.file)));
    if (complete) return { manifest, locate: (file) => urls.get(file) ?? null };
  }
  return null;
}

async function loadCatalog(): Promise<Catalog | null> {
  if (env.FIRMWARE_DIR) return fromFolder(env.FIRMWARE_DIR);
  if (!env.FIRMWARE_REPO) return null;
  return fromGitHub(env.FIRMWARE_REPO);
}

/** The newest published firmware, or null when there is none or it cannot be reached just now. */
export async function latestFirmware(): Promise<FirmwareManifest | null> {
  return (await catalog())?.manifest ?? null;
}

async function catalog(): Promise<Catalog | null> {
  if (!env.DEVICES_ENABLED || !env.FIRMWARE_UPDATES) return null;
  if (cached && Date.now() < cached.until) return cached.catalog;
  pending ??= loadCatalog()
    .then((found) => {
      cached = { catalog: found, until: Date.now() + CHECK_MS };
      lastLookup = { at: Date.now(), ok: true };
      return found;
    })
    .catch((error: unknown) => {
      console.warn(`Display firmware: could not look up the newest build (${error instanceof Error ? error.message : String(error)}). Trying again in 5 minutes.`);
      // Keep offering what was found before, if anything.
      cached = { catalog: cached?.catalog ?? null, until: Date.now() + RETRY_MS };
      lastLookup = { at: Date.now(), ok: false };
      return cached.catalog;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * Look for new firmware now rather than within the hour, for "Check for new firmware" in Settings. A lookup in
 * the last minute is reused. `reached` is false when the releases could not be read just now; whatever was
 * found before is still offered then.
 */
export async function checkFirmwareNow(): Promise<{ manifest: FirmwareManifest | null; reached: boolean; checkedAt: Date | null }> {
  if (!env.DEVICES_ENABLED || !env.FIRMWARE_UPDATES) return { manifest: null, reached: true, checkedAt: null };
  if (!pending && cached && Date.now() - lastCheckNow >= CHECK_NOW_MS) {
    lastCheckNow = Date.now();
    cached = { ...cached, until: 0 };
  }
  const manifest = await latestFirmware();
  return { manifest, reached: lastLookup?.ok ?? true, checkedAt: lastLookup ? new Date(lastLookup.at) : null };
}

/** The build for a display's board in the newest firmware, if there is one. */
export async function buildFor(model: string): Promise<{ version: string; build: FirmwareBuild } | null> {
  const manifest = await latestFirmware();
  const board = boardOf(model);
  const build = manifest?.builds.find((b) => b.model === board);
  return manifest && build ? { version: manifest.version, build } : null;
}

/**
 * A firmware file's bytes, checked against its SHA-256. Fetched once and then kept in memory: three boards'
 * images come to a few MB. Null when it cannot be had just now.
 */
export async function firmwareFile(file: FirmwareFile): Promise<Buffer | null> {
  const known = files.get(file.sha256);
  if (known) return known;
  const where = (await catalog())?.locate(file.file);
  if (!where) return null;
  try {
    let bytes: Buffer;
    if (/^https?:\/\//.test(where)) {
      const response = await fetchWithTimeout(where, 'application/octet-stream');
      if (!response.ok) throw new Error(`answered ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      bytes = await readFile(where);
    }
    if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error('its size or checksum does not match the manifest');
    }
    files.set(file.sha256, bytes);
    return bytes;
  } catch (error) {
    console.warn(`Display firmware: could not fetch ${file.file} (${error instanceof Error ? error.message : String(error)}).`);
    return null;
  }
}

/** For tests: forget what was looked up, so a changed FIRMWARE_DIR is read again. */
export function resetFirmwareCache(): void {
  cached = null;
  pending = null;
  lastLookup = null;
  lastCheckNow = 0;
  files.clear();
}
