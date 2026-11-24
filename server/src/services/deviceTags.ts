import type { Db } from '@/db';
import { HttpError } from '@/http';
import { itemSelect } from '@/services/deviceOverview';
import { TAG_PATTERN } from '@/services/tags';

/**
 * Tags tapped on a location display's reader. The display names a tag by a key, of one of two kinds:
 *
 * - the chip's UID (8 to 20 hex digits), for an NFC sticker. An item is found by "NFC" + UID (a sticker written
 *   or scanned in Wrkbench, see stickerTag in the client) or by the bare UID (a tag id someone typed in by hand);
 * - "T" and a spool's own tag id, for a Bambu Lab spool. The chip's UID is not what a printer reports for the
 *   spool, so the display unlocks the tag and the id is read from its data (integrations/bambu/tag.ts). That
 *   id is exactly what Item.tagId holds for a spool a printer has recognised.
 */

const CHIP = /^[0-9A-F]{8,20}$/;
const SPOOL = /^T[0-9A-Z]{4,32}$/;

const refuse = () => new HttpError(400, 'That is not a tag id the reader could have read');

/** A chip UID as the reader gives it: 4, 7 or 10 bytes in hex. Tidied to capitals with no separators. */
export function readUid(raw: string): string {
  const uid = raw.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!CHIP.test(uid)) throw refuse();
  return uid;
}

/** A tag key as the display sends it back: a chip UID, or "T" and a spool's own tag id. */
export function readTagKey(raw: string): string {
  const key = raw.trim().toUpperCase();
  return SPOOL.test(key) ? key : readUid(raw);
}

/** The key for a spool's own tag id. */
export const spoolKey = (tagId: string): string => `T${tagId}`;

/** Whether a key names a spool's own tag (a Bambu Lab spool) rather than a sticker's chip. */
export const isSpoolKey = (key: string): boolean => key.startsWith('T');

/** What linking stores on the item: the spool's own tag id, or the sticker form of a chip UID. */
export const tagIdFor = (key: string): string => {
  const tag = isSpoolKey(key) ? key.slice(1) : `NFC${key}`;
  if (!TAG_PATTERN.test(tag)) throw refuse();
  return tag;
};

/** The one item a tapped tag belongs to, or null when none does (or, should it ever happen, more than one). */
export async function itemForKey(db: Db, workspaceId: string, key: string) {
  const items = await db.item.findMany({
    where: { workspaceId, archived: false, tagId: { in: isSpoolKey(key) ? [tagIdFor(key)] : [tagIdFor(key), key] } },
    select: itemSelect,
    take: 2,
  });
  return items.length === 1 ? items[0] : null;
}
