/**
 * A record of what a barcode scanner sends the browser, for the scanner test. Scanners differ in how their
 * characters arrive (key presses, text typed by an on-screen keyboard, or both), and a report of exactly what
 * came in, with the pause before each event, shows why a scan was or was not read.
 */

export interface KeyRecord {
  /** The event's type: keydown, keyup, beforeinput, input, compositionstart and so on, or "scan" for a read. */
  type: string;
  /** When it happened, in milliseconds (the event's timeStamp). */
  at: number;
  /** Where it landed: "box" for the test's own field, "page" for anywhere else. */
  where: string;
  key?: string;
  code?: string;
  keyCode?: number;
  /** Text an input event carries, or the text a scan was read as. */
  data?: string | null;
  inputType?: string;
  composing?: boolean;
  modifiers?: string;
}

/** Keep the report short enough to paste into a message. */
export const MAX_RECORDS = 300;

const quote = (text: string) => JSON.stringify(text);

/** One line of the report. `previousAt` is the time of the event before it, if any. */
export function describeRecord(record: KeyRecord, previousAt?: number): string {
  const gap = previousAt === undefined ? '' : `+${Math.max(0, Math.round(record.at - previousAt))}ms`;
  const parts = [gap.padStart(8), record.type.padEnd(16), record.where];
  if (record.type === 'scan') return [...parts, `read as ${quote(record.data ?? '')}`].join(' ');
  if (record.key !== undefined) parts.push(`key=${quote(record.key)}`);
  if (record.code !== undefined) parts.push(`code=${quote(record.code)}`);
  if (record.keyCode !== undefined) parts.push(`keyCode=${record.keyCode}`);
  if (record.inputType) parts.push(`inputType=${record.inputType}`);
  if (record.data !== undefined) parts.push(`data=${record.data === null ? 'null' : quote(record.data)}`);
  if (record.composing) parts.push('composing');
  if (record.modifiers) parts.push(record.modifiers);
  return parts.join(' ');
}

/** The whole report: the browser it came from, then one line per event, oldest first. */
export function keyReport(records: KeyRecord[], userAgent: string): string {
  const scans = records.filter((record) => record.type === 'scan').length;
  const lines = records.map((record, i) => describeRecord(record, i === 0 ? undefined : records[i - 1].at));
  return [`Browser: ${userAgent}`, `Events: ${records.length}, read as a scan: ${scans}`, '', ...lines].join('\n');
}
