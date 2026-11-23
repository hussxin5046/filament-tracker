/**
 * Reading and writing NFC tags from the page (Web NFC). Only Chrome on Android has it, only on a secure
 * address, and only after a tap; everywhere else the buttons that use this are not shown, and a tag is read
 * by the phone itself opening the link it carries.
 */

/** What Wrkbench looks for on a tag: the link to the spool, the OpenSpool record, and the tag's own serial. */
export interface TagContents {
  /** As the phone reports it, e.g. "04:a1:b2:c3:d4:e5:f6". Some tags have none. */
  serial: string | null;
  url: string | null;
  /** The JSON record's text, not yet parsed. */
  json: string | null;
}

interface NfcRecord {
  recordType: string;
  mediaType?: string | null;
  data?: DataView | null;
}
interface NfcReadingEvent extends Event {
  serialNumber?: string;
  message: { records: NfcRecord[] };
}
interface NfcRecordInit {
  recordType: string;
  mediaType?: string;
  data: string | BufferSource;
}
interface NfcReader extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(message: { records: NfcRecordInit[] }, options?: { overwrite?: boolean; signal?: AbortSignal }): Promise<void>;
}

const Reader = (): (new () => NfcReader) | undefined => (window as unknown as { NDEFReader?: new () => NfcReader }).NDEFReader;

export const nfcAvailable = (): boolean => window.isSecureContext && Boolean(Reader());

/**
 * Which record goes first. A phone that is tapped on a tag (without the app open) acts on the first record, so
 * the link goes first and tapping opens the spool. OpenSpool readers that look only at the first record would
 * want the data first: change this one line if that matters more than tap-to-open.
 */
export const LINK_FIRST = true;

const JSON_TYPE = 'application/json';

function contentsOf(event: NfcReadingEvent): TagContents {
  const decoder = new TextDecoder();
  let url: string | null = null;
  let json: string | null = null;
  for (const record of event.message.records) {
    if (!record.data) continue;
    const text = decoder.decode(record.data);
    if (record.recordType === 'url' || record.recordType === 'absolute-url') url ??= text;
    else if (record.recordType === 'mime' && (record.mediaType ?? '').startsWith(JSON_TYPE)) json ??= text;
    // A tag written by another tool may hold the record as plain text.
    else if (record.recordType === 'text' && text.trim().startsWith('{')) json ??= text;
  }
  return { serial: event.serialNumber || null, url, json };
}

/**
 * A Bambu Lab spool's own tag is locked: it opens only with keys worked out from its serial, which a reader made
 * for it (the printer's AMS, a location display's tag reader) knows and a phone's browser cannot use. To the
 * phone it is a tag it cannot read, or one with nothing on it, so whichever it says, say this too.
 */
export const BAMBU_TAG_NOTE = "A Bambu Lab spool's own tag cannot be read by a phone: scan the spool's label instead, or let the printer or a location display read the tag.";

/** Why NFC could not be used, in words for the person holding the phone. */
export function nfcProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') return 'Wrkbench is not allowed to use NFC. Allow it for this site in Chrome, then try again.';
  if (name === 'NotReadableError') return 'NFC is switched off. Turn it on in the phone\'s settings, then try again.';
  if (name === 'NotSupportedError') return 'This phone cannot read NFC tags.';
  if (name === 'NetworkError') return 'The tag moved away too soon. Hold it still against the back of the phone and try again.';
  return 'The tag could not be read. Hold it still against the back of the phone and try again.';
}

export interface TagSession {
  /** Write to the tag that was just read, while it is still held against the phone. */
  write: (url: string, json: string) => Promise<void>;
  stop: () => void;
}

/**
 * Start listening for a tag. `onTag` is called each time one is held to the phone; `onError` when a tag is
 * there but cannot be read. The promise rejects if listening cannot start at all (no permission, NFC off).
 */
export async function listenForTags(onTag: (contents: TagContents) => void, onError: (message: string) => void): Promise<TagSession> {
  const NDEFReader = Reader();
  if (!NDEFReader) throw new DOMException('Web NFC is not available', 'NotSupportedError');
  const reader = new NDEFReader();
  const abort = new AbortController();
  reader.addEventListener('reading', (event) => onTag(contentsOf(event as NfcReadingEvent)), { signal: abort.signal });
  reader.addEventListener('readingerror', () => onError(`${nfcProblem(null)} ${BAMBU_TAG_NOTE}`), { signal: abort.signal });
  await reader.scan({ signal: abort.signal });
  return {
    write: (url, json) => {
      const link: NfcRecordInit = { recordType: 'url', data: url };
      const data: NfcRecordInit = { recordType: 'mime', mediaType: JSON_TYPE, data: new TextEncoder().encode(json) };
      // Never locked: a sticker must stay rewritable for when it moves to another spool.
      return reader.write({ records: LINK_FIRST ? [link, data] : [data, link] }, { overwrite: true, signal: abort.signal });
    },
    stop: () => abort.abort(),
  };
}
