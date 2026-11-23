import { describe, expect, it } from 'vitest';
import { describeRecord, keyReport, type KeyRecord } from '@/lib/keyLog';

describe('key log', () => {
  it('describes a key press with the pause before it', () => {
    const line = describeRecord({ type: 'keydown', at: 1012.4, where: 'page', key: '5', code: 'Digit5', keyCode: 53 }, 1000);
    expect(line).toBe('   +12ms keydown          page key="5" code="Digit5" keyCode=53');
  });

  it('shows what an on-screen keyboard reports, which has no real key', () => {
    const line = describeRecord({ type: 'keydown', at: 0, where: 'box', key: 'Unidentified', keyCode: 229, composing: true });
    expect(line).toContain('key="Unidentified"');
    expect(line).toContain('keyCode=229');
    expect(line).toContain('composing');
  });

  it('describes text typed into a field', () => {
    const line = describeRecord({ type: 'input', at: 5, where: 'box', inputType: 'insertText', data: 'LOC-014' }, 0);
    expect(line).toContain('inputType=insertText data="LOC-014"');
    expect(describeRecord({ type: 'input', at: 5, where: 'box', inputType: 'deleteContentBackward', data: null })).toContain('data=null');
  });

  it('describes a read', () => {
    expect(describeRecord({ type: 'scan', at: 30, where: 'page', data: '5901234123457' }, 20)).toContain('read as "5901234123457"');
  });

  it('starts the report with the browser and a count of reads', () => {
    const records: KeyRecord[] = [
      { type: 'keydown', at: 0, where: 'page', key: '1' },
      { type: 'keydown', at: 4, where: 'page', key: 'Enter' },
      { type: 'scan', at: 4, where: 'page', data: '1' },
    ];
    const report = keyReport(records, 'Test browser').split('\n');
    expect(report[0]).toBe('Browser: Test browser');
    expect(report[1]).toBe('Events: 3, read as a scan: 1');
    expect(report[3]).not.toContain('ms');
    expect(report[4]).toContain('+4ms');
  });
});
