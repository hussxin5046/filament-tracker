import { describe, expect, it } from 'vitest';
import { isPutAway, itemPlace } from '@/lib/format';
import type { Location } from '@/lib/types';

const locations = [
  { id: 'room', name: 'Workshop', parentId: null },
  { id: 'shelf', name: 'Shelf A', parentId: 'room' },
] as Location[];
const ams = { position: 2, label: '', subUnit: { id: 'ams1', name: 'AMS 1', machineId: 'x1c' } };

describe('where an item is kept', () => {
  it('counts a spool loaded in an AMS as put away, even with no location', () => {
    expect(isPutAway({ locationId: null, slot: ams })).toBe(true);
    expect(isPutAway({ locationId: 'shelf', slot: null })).toBe(true);
    expect(isPutAway({ locationId: null, slot: null })).toBe(false);
  });

  it('names the AMS slot first, then the location path', () => {
    expect(itemPlace({ locationId: 'shelf', slot: ams }, locations)).toBe('AMS 1 · slot 2');
    expect(itemPlace({ locationId: 'shelf', slot: null }, locations)).toBe('Workshop › Shelf A');
    expect(itemPlace({ locationId: null, slot: null }, locations)).toBe('');
  });
});
