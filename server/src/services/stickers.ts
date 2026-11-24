import { cannotWriteSticker, openSpoolRecord, stickerBytes, type SpoolSource } from '@filament-tracker/protocol/openspool';
import { spoolFacts, type SpoolFactsSource } from '@/integrations/amsSync';
import { appUrl } from '@/services/mail';

/**
 * Spool stickers written by a location display's tag reader. The display is handed the exact bytes to put on
 * the sticker, built by the same shared format a phone uses (protocol/src/openspool.ts): the link that opens the
 * spool in Wrkbench, then the OpenSpool record saying what the filament is.
 */

type StickerItem = SpoolFactsSource & { id: string };

function source(item: StickerItem): SpoolSource {
  const facts = spoolFacts(item);
  const values = (item.fields ?? {}) as Record<string, unknown>;
  return { material: facts.material, colour: facts.colour, brand: values.brand, nozzleTemp: values.nozzle_temp };
}

/** Why no sticker can be written for an item, in words for the display; null when one can. */
export const stickerProblem = (item: StickerItem): string | null => cannotWriteSticker(source(item));

/** The sticker's bytes as hexadecimal, from page 4 of an NTAG215/216 on; null when the item cannot have one. */
export function stickerHex(item: StickerItem): string | null {
  const record = openSpoolRecord(source(item));
  if (!record) return null;
  return Buffer.from(stickerBytes(appUrl(`/s/${item.id}`), JSON.stringify(record))).toString('hex').toUpperCase();
}
