import { describe, expect, it } from 'vitest';
import { cannotWriteSticker, openSpoolRecord, stickerBytes } from '@filament-tracker/protocol/openspool';
import { readSticker } from './ndef';

/** The sticker format shared by the web app and location displays: the record, and the bytes a display writes. */

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('the OpenSpool record', () => {
  it('takes the spool\'s own temperatures, or the usual ones for its material', () => {
    expect(openSpoolRecord({ material: 'PETG', colour: '#1a2b3c', brand: ' Prusament ', nozzleTemp: '230-250 C' })).toEqual({
      protocol: 'openspool', version: '1.0', type: 'PETG', color_hex: '1A2B3C', brand: 'Prusament', min_temp: '230', max_temp: '250',
    });
    expect(openSpoolRecord({ material: 'PLA', colour: null, brand: '', nozzleTemp: undefined })).toMatchObject({ color_hex: 'FFFFFF', brand: 'Generic', min_temp: '190', max_temp: '220' });
  });

  it('says why a sticker cannot be written', () => {
    expect(cannotWriteSticker({ material: null, colour: null, brand: null, nozzleTemp: null })).toMatch(/no material/);
    expect(cannotWriteSticker({ material: 'PEEK', colour: null, brand: null, nozzleTemp: null })).toMatch(/nozzle temperature/);
    expect(openSpoolRecord({ material: 'PEEK', colour: null, brand: null, nozzleTemp: null })).toBeNull();
    expect(cannotWriteSticker({ material: 'PEEK', colour: null, brand: null, nozzleTemp: 400 })).toBeNull();
  });
});

describe('the bytes on a sticker', () => {
  it('hold the link first, then the OpenSpool record, in one NDEF message', () => {
    const json = '{"protocol":"openspool","type":"PLA"}';
    const records = readSticker(hex(stickerBytes('https://wrkbench.example/s/abc123', json)));
    expect(records).toEqual([
      { tnf: 1, type: 'U', text: 'https://wrkbench.example/s/abc123', first: true, last: false },
      { tnf: 2, type: 'application/json', text: json, first: false, last: true },
    ]);
  });

  it('shortens the start of the link the way NFC readers expect', () => {
    expect(stickerBytes('https://www.example.com/s/1', '{}')[6]).toBe(0x02);
    expect(stickerBytes('http://192.168.1.5:4000/s/1', '{}')[6]).toBe(0x03);
    expect(readSticker(hex(stickerBytes('http://192.168.1.5:4000/s/1', '{}')))[0].text).toBe('http://192.168.1.5:4000/s/1');
  });

  it('uses the long length forms when a record or the message passes 255 bytes', () => {
    const json = JSON.stringify({ protocol: 'openspool', brand: 'x'.repeat(300) });
    const bytes = stickerBytes('https://wrkbench.example/s/abc123', json);
    expect(bytes[1]).toBe(0xff);
    expect(readSticker(hex(bytes))[1].text).toBe(json);
  });
});
