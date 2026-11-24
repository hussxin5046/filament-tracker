/**
 * OpenSpool: an open format for NFC stickers on filament spools. The sticker holds one small JSON record saying
 * what the filament is, so any OpenSpool reader or app can tell. Wrkbench writes that record plus a link to the
 * spool in stock.
 *
 * Shared by the web app (a phone writes the sticker) and the server (it hands a location display the bytes to
 * write), so a sticker reads the same whichever wrote it.
 */

export interface OpenSpoolRecord {
  protocol: 'openspool';
  version: '1.0';
  /** Material: "PLA", "PETG" … */
  type: string;
  /** Six hexadecimal digits, no "#". */
  color_hex: string;
  brand: string;
  /** Nozzle temperatures in °C, as text, as the format has them. */
  min_temp: string;
  max_temp: string;
}

/** What a spool in stock says about itself: its material, colour ("#rrggbb"), and its brand and nozzle temperature fields as stored. */
export interface SpoolSource {
  material: string | null;
  colour: string | null;
  brand: unknown;
  nozzleTemp: unknown;
}

/**
 * Usual nozzle ranges, used only when a spool in stock does not say its own. A reader acts on these numbers,
 * so a tag is never written without them.
 */
const USUAL_TEMPS: Array<[material: RegExp, min: number, max: number]> = [
  [/^pla/i, 190, 220],
  [/^petg/i, 220, 250],
  [/^(abs|asa)/i, 240, 270],
  [/^tpu/i, 210, 240],
  [/^(pa|nylon)/i, 260, 290],
  [/^pc/i, 260, 290],
];

function temperatures(raw: unknown, material: string): [number, number] | null {
  const numbers = typeof raw === 'number' ? [raw] : typeof raw === 'string' ? (raw.match(/\d+/g) ?? []).map(Number) : [];
  const sensible = numbers.filter((value) => value >= 100 && value <= 500);
  if (sensible.length >= 2) return [Math.min(...sensible), Math.max(...sensible)];
  if (sensible.length === 1) return [sensible[0], sensible[0]];
  const usual = USUAL_TEMPS.find(([pattern]) => pattern.test(material));
  return usual ? [usual[1], usual[2]] : null;
}

/** Why a sticker cannot be written for a spool, in words for whoever is holding it; null when it can. */
export function cannotWriteSticker(spool: SpoolSource): string | null {
  if (!spool.material) return 'Only filament spools can be written to a spool tag: this item has no material.';
  if (!temperatures(spool.nozzleTemp, spool.material)) return `Add a nozzle temperature to this spool first: there is no usual one for ${spool.material}, and readers need it.`;
  return null;
}

/** The record to write for a spool in stock, or null when it is not a spool or lacks what a reader needs. */
export function openSpoolRecord(spool: SpoolSource): OpenSpoolRecord | null {
  if (!spool.material) return null;
  const temps = temperatures(spool.nozzleTemp, spool.material);
  if (!temps) return null;
  const brand = spool.brand;
  return {
    protocol: 'openspool',
    version: '1.0',
    type: spool.material,
    // A spool with no colour recorded is written as white rather than left out: readers expect the key.
    color_hex: (spool.colour ?? '#ffffff').slice(1).toUpperCase(),
    brand: typeof brand === 'string' && brand.trim() ? brand.trim() : 'Generic',
    min_temp: String(temps[0]),
    max_temp: String(temps[1]),
  };
}

/**
 * Which record goes first. A phone that is tapped on a tag (without the app open) acts on the first record, so
 * the link goes first and tapping opens the spool. OpenSpool readers that look only at the first record would
 * want the data first: change this one line if that matters more than tap-to-open.
 */
export const LINK_FIRST = true;

export const OPENSPOOL_MEDIA_TYPE = 'application/json';

// The NFC Forum's short forms for the start of a link (URI record type, table 3). Longest first.
const URI_PREFIXES: Array<[code: number, prefix: string]> = [
  [0x02, 'https://www.'],
  [0x01, 'http://www.'],
  [0x04, 'https://'],
  [0x03, 'http://'],
];

const utf8 = (text: string) => new TextEncoder().encode(text);

/** One NDEF record. `first` and `last` set the message begin and end flags. */
function ndefRecord(tnf: number, type: Uint8Array, payload: Uint8Array, first: boolean, last: boolean): number[] {
  const short = payload.length < 256;
  const header = (first ? 0x80 : 0) | (last ? 0x40 : 0) | (short ? 0x10 : 0) | tnf;
  const length = short ? [payload.length] : [(payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff];
  return [header, type.length, ...length, ...type, ...payload];
}

function uriPayload(url: string): Uint8Array {
  const [code, prefix] = URI_PREFIXES.find(([, start]) => url.toLowerCase().startsWith(start)) ?? [0x00, ''];
  return new Uint8Array([code, ...utf8(url.slice(prefix.length))]);
}

/**
 * The bytes a sticker's user memory holds for a spool: the NDEF message (the link and the OpenSpool record, in
 * the order LINK_FIRST says) inside an NDEF TLV, then the terminator TLV. This is how an NTAG215/216 sticker
 * (NFC Forum Type 2) carries it, starting at page 4. A phone's browser does the same when it writes the records.
 */
export function stickerBytes(url: string, json: string): Uint8Array {
  const link = (first: boolean, last: boolean) => ndefRecord(0x01, utf8('U'), uriPayload(url), first, last);
  const data = (first: boolean, last: boolean) => ndefRecord(0x02, utf8(OPENSPOOL_MEDIA_TYPE), utf8(json), first, last);
  const message = LINK_FIRST ? [...link(true, false), ...data(false, true)] : [...data(true, false), ...link(false, true)];
  const length = message.length < 0xff ? [message.length] : [0xff, (message.length >>> 8) & 0xff, message.length & 0xff];
  return new Uint8Array([0x03, ...length, ...message, 0xfe]);
}
