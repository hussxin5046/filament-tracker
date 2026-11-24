import { cannotWriteSticker, openSpoolRecord, type OpenSpoolRecord, type SpoolSource } from '@filament-tracker/protocol/openspool';
import type { Catalog } from '@/hooks/useCatalog';
import { spoolFacts } from '@/lib/spoolMatch';
import type { Detected, Item } from '@/lib/types';

/**
 * OpenSpool: an open format for NFC stickers on filament spools. The sticker holds one small JSON record
 * saying what the filament is, so any OpenSpool reader or app can tell. Wrkbench writes that record plus a
 * link to the spool in stock, and reads either. Readers skip records and keys they do not know.
 */

export type { OpenSpoolRecord } from '@filament-tracker/protocol/openspool';

/** What the shared sticker format needs to know about a spool in stock. */
function source(item: Item, catalog: Catalog): SpoolSource {
  const facts = spoolFacts(item, catalog);
  return { material: facts.material, colour: facts.colour, brand: item.fields.brand, nozzleTemp: item.fields.nozzle_temp };
}

/** Why a tag cannot be written for an item, in words for whoever is holding the sticker; null when it can. */
export const cannotTag = (item: Item, catalog: Catalog): string | null => cannotWriteSticker(source(item, catalog));

/** The record to write for a spool in stock, or null when the item is not a spool or lacks what a reader needs. */
export const toOpenSpool = (item: Item, catalog: Catalog): OpenSpoolRecord | null => openSpoolRecord(source(item, catalog));

const text = (value: unknown): string | null => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null);

/**
 * What a tag says, in the same shape a connected printer reports a tray in, so everything that already works
 * from a printer's reading (filling in a new spool, ranking stock against it) works from a tag too.
 * Lenient about how the values are written; null when the record does not even name a material.
 */
export function fromOpenSpool(record: Record<string, unknown>): Detected | null {
  const material = text(record.type);
  if (!material) return null;
  const hex = text(record.color_hex)?.replace(/^#/, '') ?? '';
  const colour = /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex) ? `#${hex.slice(0, 6).toLowerCase()}` : null;
  const brand = text(record.brand);
  const min = Number(text(record.min_temp));
  const max = Number(text(record.max_temp));
  const temps = Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0 ? ([Math.min(min, max), Math.max(min, max)] as [number, number]) : null;
  return {
    state: 'loaded',
    material,
    subType: null,
    colour,
    colours: [],
    // "Generic" is the format's word for no brand at all.
    brand: brand && brand.toLowerCase() !== 'generic' ? brand : null,
    tagId: null,
    remainingPercent: null,
    spoolWeightGrams: null,
    nozzleTemp: temps,
  };
}

/**
 * How a sticker's serial is kept on an item: "NFC" and the serial's hexadecimal digits. Phones report it as
 * "04:a1:b2:…". The prefix keeps it apart from the tags printers read, which are hexadecimal throughout.
 */
export function stickerTag(serial: string | null | undefined): string | null {
  const digits = (serial ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return digits.length >= 4 && digits.length <= 32 ? `NFC${digits}` : null;
}
