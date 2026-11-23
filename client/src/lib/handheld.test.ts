import { describe, expect, it } from 'vitest';
import { readHandheldScan } from '@/lib/handheld';
import type { Item, Location } from '@/lib/types';

const items = [
  { id: 'i1', name: 'PLA Black 1', sku: '5901234123457' },
  { id: 'i2', name: 'PLA Black 2', sku: '5901234123457' },
  { id: 'i3', name: 'M3 screws', sku: 'M3-10' },
] as Item[];
const locations = [{ id: 'l1', name: 'Shelf A', code: 'LOC-014' }] as Location[];

describe('reading a scan in handheld mode', () => {
  it('opens an item or a location from its label', () => {
    expect(readHandheldScan('https://shop.example/s/i3', items, locations)).toEqual({ kind: 'item', item: items[2] });
    expect(readHandheldScan('https://shop.example/l/l1', items, locations)).toEqual({ kind: 'location', location: locations[0] });
  });

  it('finds an item or a location by its code', () => {
    expect(readHandheldScan('M3-10', items, locations)).toEqual({ kind: 'item', item: items[2] });
    expect(readHandheldScan('loc-014', items, locations)).toEqual({ kind: 'location', location: locations[0] });
  });

  it('lists the items that share a maker\'s barcode', () => {
    expect(readHandheldScan('5901234123457', items, locations)).toEqual({ kind: 'several', text: '5901234123457', items: [items[0], items[1]] });
  });

  it('says why a scan opens nothing', () => {
    expect(readHandheldScan('https://shop.example/s/elsewhere', items, locations)).toMatchObject({ kind: 'problem', message: 'That label is not for an item in this workspace.' });
    expect(readHandheldScan('https://shop.example/l/elsewhere', items, locations)).toMatchObject({ kind: 'problem' });
    expect(readHandheldScan('nothing', items, locations)).toMatchObject({ kind: 'problem', message: 'Nothing here has the code "nothing".' });
    expect(readHandheldScan('{"protocol":"openspool","type":"PLA"}', items, locations)).toMatchObject({ kind: 'problem' });
  });
});
