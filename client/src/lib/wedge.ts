/**
 * Telling a barcode scanner from a person at the keyboard. A handheld scanner (and a Zebra mobile computer set to
 * send keystrokes) types the code far faster than anyone can, then presses Enter. So: a run of characters with
 * no pause between them, ended by Enter, is a scan.
 *
 * Some scanners do not type one key per character. A Zebra mobile computer with Chrome hands the whole code to
 * the selected text box at once, the way an on-screen keyboard enters a word, then presses Enter. That arrives
 * as text (feedText), and counts the same.
 */

export interface WedgeOptions {
  /** The longest pause between two characters of one scan, in milliseconds. */
  maxGapMs?: number;
  /** Fewer characters than this is not a scan, however fast. */
  minLength?: number;
}

export interface Wedge {
  /**
   * Feed every key press with the time it happened. Returns the scanned text when this key ends a scan.
   * `modified` is true while Ctrl, Alt or the Command/Windows key is held: shortcuts are never part of a scan.
   */
  feed: (key: string, at: number, modified?: boolean) => string | null;
  /** Feed text that arrived without key presses for its characters, with the time it arrived. */
  feedText: (text: string, at: number) => void;
  /** How many characters of a possible scan have arrived so far. */
  pending: () => number;
}

export function createWedge({ maxGapMs = 100, minLength = 4 }: WedgeOptions = {}): Wedge {
  let buffer = '';
  let last = 0;

  const reset = () => {
    buffer = '';
  };

  return {
    feed(key, at, modified = false) {
      if (modified) {
        reset();
        return null;
      }
      const late = buffer !== '' && at - last > maxGapMs;
      if (key === 'Enter' || key === 'Tab') {
        const text = late ? '' : buffer;
        reset();
        return text.length >= minLength ? text : null;
      }
      // Shift and the like arrive between the characters of a scan (for ":" or a capital) and are not part of it.
      if (key.length !== 1) return null;
      if (late) reset();
      buffer += key;
      last = at;
      return null;
    },
    feedText(text, at) {
      if (!text) return;
      if (buffer !== '' && at - last > maxGapMs) reset();
      buffer += text;
      last = at;
    },
    pending: () => buffer.length,
  };
}
