import { describe, expect, it } from 'vitest';
import { loadCommonPasswords, PASSWORD_HINT, passwordNote, REFUSALS, weakness } from '@/lib/passwordRules';

/** The same cases as server/test/passwordRules.test.ts: the two sets of rules must agree. */
describe('the rules for a new password, as shown while typing', () => {
  const owner = { email: 'demo@workshop.test', name: 'Demo Maker' };

  it('agrees with the server on each rule', async () => {
    const common = await loadCommonPasswords();
    expect(weakness('eleven char')).toBe('short');
    expect(weakness('twelve chars')).toBeNull();
    expect(weakness('🔧🪛🔩🧰🪚🔨🧲🪜📐📏🧵🪡')).toBeNull();
    expect(weakness('all lower case words', owner, common)).toBeNull();
    const fits = 'correct horse battery staple '.repeat(3).slice(0, 72);
    expect(weakness(fits, owner, common)).toBeNull();
    expect(weakness(`${fits}x`)).toBe('long');
    expect(weakness('🔧'.repeat(19))).toBe('long');
    expect(weakness('Qwerty123456', owner, common)).toBe('common');
    expect(weakness('aaaaaaaaaaaa')).toBe('repeated');
    expect(weakness('abcdabcdabcdab')).toBe('repeated');
    expect(weakness('lathe bench lathe bench')).toBeNull();
    expect(weakness('Demo@Workshop.test', owner)).toBe('personal');
    expect(weakness('DemoMaker2026!', owner)).toBe('personal');
    expect(weakness('Wrkbench-2026')).toBe('personal');
    expect(weakness('demo maker likes walnut', owner)).toBeNull();
    expect(weakness('al1234567890', { name: 'Al' })).toBeNull();
  });

  it('leaves the common list to the server until it has loaded', () => {
    expect(weakness('qwerty123456', owner, null)).toBeNull();
  });

  it('says nothing before typing, counts down, then gives a verdict', () => {
    expect(passwordNote('')).toBeNull();
    expect(passwordNote('seven c')).toEqual({ tone: 'quiet', text: '5 more characters needed.' });
    expect(passwordNote('eleven char')).toEqual({ tone: 'quiet', text: '1 more character needed.' });
    expect(passwordNote('twelve chars')).toEqual({ tone: 'good', text: 'Long enough.' });
    expect(passwordNote('aaaaaaaaaaaa')).toEqual({ tone: 'bad', text: REFUSALS.repeated });
    expect(passwordNote('🔧'.repeat(19))).toEqual({ tone: 'bad', text: 'Too long. Use at most 72 characters (fewer with accents or emoji).' });
    expect(PASSWORD_HINT).toBe('At least 12 characters. A few unrelated words work well. No symbols or capitals needed.');
  });
});
