/**
 * Reads back what a sticker's user memory holds, the way a phone does: the NDEF TLV, then each record in it.
 * Kept separate from the code that writes it, so the tests check the bytes against the NFC Forum layout rather
 * than against themselves.
 */

export interface ReadRecord {
  tnf: number;
  type: string;
  /** A link record's full address, or the payload as text for any other record. */
  text: string;
  first: boolean;
  last: boolean;
}

const URI_CODES: Record<number, string> = { 0: '', 1: 'http://www.', 2: 'https://www.', 3: 'http://', 4: 'https://' };

export function readSticker(hex: string): ReadRecord[] {
  const bytes = Buffer.from(hex, 'hex');
  if (bytes[0] !== 0x03) throw new Error('No NDEF TLV at the start');
  let at = 1;
  let length = bytes[at++];
  if (length === 0xff) {
    length = (bytes[at] << 8) | bytes[at + 1];
    at += 2;
  }
  const end = at + length;
  if (bytes[end] !== 0xfe) throw new Error('No terminator TLV after the message');
  const records: ReadRecord[] = [];
  while (at < end) {
    const header = bytes[at++];
    const typeLength = bytes[at++];
    const short = (header & 0x10) !== 0;
    const payloadLength = short ? bytes[at++] : bytes.readUInt32BE(at);
    if (!short) at += 4;
    if (header & 0x08) throw new Error('An ID field was not expected');
    const type = bytes.subarray(at, at + typeLength).toString('utf8');
    at += typeLength;
    const payload = bytes.subarray(at, at + payloadLength);
    at += payloadLength;
    const tnf = header & 0x07;
    const text = tnf === 0x01 && type === 'U' ? URI_CODES[payload[0]] + payload.subarray(1).toString('utf8') : payload.toString('utf8');
    records.push({ tnf, type, text, first: (header & 0x80) !== 0, last: (header & 0x40) !== 0 });
  }
  if (at !== end) throw new Error('The records do not fill the message exactly');
  return records;
}
