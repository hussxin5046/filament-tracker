import { describe, expect, it } from 'vitest';
import { createWedge, type Wedge } from '@/lib/wedge';

/** Type `text` one key every `gap` ms starting at `start`, then press `end`. Returns what the last key gave. */
function type(wedge: Wedge, text: string, gap: number, start = 1000, end = 'Enter') {
  let at = start;
  for (const key of text) {
    expect(wedge.feed(key, at)).toBeNull();
    at += gap;
  }
  return wedge.feed(end, at);
}

describe('telling a scanner from a person typing', () => {
  it('reads a fast run of characters ended by Enter as a scan', () => {
    expect(type(createWedge(), '5901234123457', 5)).toBe('5901234123457');
    expect(type(createWedge(), 'LOC-014', 20, 1000, 'Tab')).toBe('LOC-014');
  });

  it('ignores typing at a human pace', () => {
    expect(type(createWedge(), '5901234123457', 150)).toBeNull();
  });

  it('ignores a pause before Enter', () => {
    const wedge = createWedge();
    for (const [i, key] of [...'12345'].entries()) wedge.feed(key, 1000 + i * 5);
    expect(wedge.feed('Enter', 2000)).toBeNull();
  });

  it('ignores runs that are too short', () => {
    expect(type(createWedge(), 'abc', 5)).toBeNull();
    expect(type(createWedge({ minLength: 3 }), 'abc', 5)).toBe('abc');
  });

  it('keeps only the scan when it follows slower typing', () => {
    const wedge = createWedge();
    wedge.feed('x', 0);
    wedge.feed('y', 400);
    expect(type(wedge, 'ABCD1234', 5, 1000)).toBe('ABCD1234');
  });

  it('skips Shift and other named keys inside a scan', () => {
    const wedge = createWedge();
    let at = 0;
    for (const key of ['h', 't', 't', 'p', 's', 'Shift', ':', '/', '/', 'x', '/', 's', '/', 'a', 'b']) wedge.feed(key, (at += 5));
    expect(wedge.feed('Enter', at + 5)).toBe('https://x/s/ab');
  });

  it('never takes a keyboard shortcut for part of a scan', () => {
    const wedge = createWedge();
    for (const [i, key] of [...'1234'].entries()) wedge.feed(key, i * 5);
    wedge.feed('v', 25, true);
    expect(wedge.feed('Enter', 30)).toBeNull();
  });

  it('starts afresh after each scan', () => {
    const wedge = createWedge();
    expect(type(wedge, '11112222', 5, 0)).toBe('11112222');
    expect(wedge.pending()).toBe(0);
    expect(type(wedge, '33334444', 5, 5000)).toBe('33334444');
  });

  it('reads a code handed over in one piece, as a Zebra mobile computer does in Chrome', () => {
    const wedge = createWedge();
    expect(wedge.feed('Unidentified', 1000)).toBeNull();
    wedge.feedText('https://www.example.com/s/abc123', 1010);
    expect(wedge.feed('Enter', 1010)).toBe('https://www.example.com/s/abc123');
  });

  it('does not take a word typed on an on-screen keyboard, then Enter a moment later, for a scan', () => {
    const wedge = createWedge();
    wedge.feedText('hello', 1000);
    expect(wedge.feed('Enter', 1400)).toBeNull();
  });
});
