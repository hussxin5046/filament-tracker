import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signResetToken, signToken } from '@/auth';
import { prisma } from '@/db';
import { env } from '@/env';
import { COMMON_PASSWORDS_FILE, REFUSALS, weakness } from '@/services/passwordRules';
import { foundInLeak, resumeLeakLookups } from '@/services/passwords';
import { startApp } from './http';

/** A password that passes every rule. Nothing here is a real password of anyone's. */
const GOOD = 'nine quiet lathes hum';
/** On the built-in list. */
const COMMON = 'qwerty123456';

describe('the rules for a new password', () => {
  it('asks for 12 characters, counted the way a person counts, and nothing else of them', () => {
    expect(weakness('eleven char')).toBe('short');
    expect(weakness('twelve chars')).toBeNull();
    // 12 emoji are 12 characters, though far more bytes.
    expect(weakness('🔧🪛🔩🧰🪚🔨⚙️🧲🪜📐')).toBe('short');
    expect(weakness('🔧🪛🔩🧰🪚🔨🧲🪜📐📏🧵🪡')).toBeNull();
    // No capitals, digits or symbols are needed, and spaces are welcome.
    expect(weakness('all lower case words')).toBeNull();
  });

  it('stops at 72 bytes, where bcrypt stops reading', () => {
    const fits = 'correct horse battery staple '.repeat(3).slice(0, 72);
    expect(weakness(fits)).toBeNull();
    expect(weakness(`${fits}x`)).toBe('long');
    // 19 emoji are 19 characters but 76 bytes.
    expect(weakness('🔧'.repeat(19))).toBe('long');
  });

  it('refuses passwords everybody uses, whatever their capitals', () => {
    expect(weakness(COMMON)).toBe('common');
    expect(weakness('Qwerty123456')).toBe('common');
    expect(weakness('1q2w3e4r5t6y')).toBe('common');
  });

  it('refuses one short group of characters repeated', () => {
    expect(weakness('aaaaaaaaaaaa')).toBe('repeated');
    expect(weakness('abababababab')).toBe('repeated');
    expect(weakness('abcdabcdabcdab')).toBe('repeated');
    // A longer phrase said twice is not what this rule is for.
    expect(weakness('lathe bench lathe bench')).toBeNull();
  });

  it('refuses a password made from the account itself', () => {
    const owner = { email: 'demo@workshop.test', name: 'Demo Maker' };
    expect(weakness('Demo@Workshop.test', owner)).toBe('personal');
    expect(weakness('DemoMaker2026!', owner)).toBe('personal');
    expect(weakness('demo12345678', owner)).toBe('personal');
    expect(weakness('Wrkbench-2026', owner)).toBe('personal');
    // Their name inside a longer password is fine.
    expect(weakness('demo maker likes walnut', owner)).toBeNull();
    // A two-letter name does not rule out every password with those two letters and digits.
    expect(weakness('al1234567890', { name: 'Al' })).toBeNull();
  });

  it('keeps the web app\'s copy of the common list the same as the server\'s', async () => {
    const server = readFileSync(COMMON_PASSWORDS_FILE, 'utf8').trim();
    const client = readFileSync(fileURLToPath(new URL('../../client/src/lib/commonPasswords.ts', import.meta.url)), 'utf8');
    const match = /export const COMMON_PASSWORDS = (".*");/.exec(client);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toBe(server);
    // Every entry is one a new password could otherwise be: shorter ones are refused for their length anyway.
    const entries = server.split('\n');
    expect(entries.length).toBeGreaterThan(500);
    expect(entries.every((entry) => [...entry].length >= 12 && entry === entry.toLowerCase())).toBe(true);
  });
});

/**
 * Stands in for the leaked-password service. Calls to anything else (the app under test) go through.
 * `answer` gets the five characters asked about and says what the service replies.
 */
function fakeLeakService(answer: (prefix: string) => Response | Promise<Response>) {
  const asked: string[] = [];
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.pwnedpasswords.com/')) return real(input, init);
    asked.push(url);
    return Promise.resolve(answer(url.slice(url.lastIndexOf('/') + 1)));
  });
  return asked;
}

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex').toUpperCase();
/** What the service would say if these passwords, and only these, had leaked. */
const leaked = (...passwords: string[]) => (prefix: string) =>
  new Response(
    [
      // Padding: made-up rows with a count of 0, as the real service adds.
      `${'0'.repeat(35)}:0`,
      ...passwords.filter((password) => sha1(password).startsWith(prefix)).map((password) => `${sha1(password).slice(5)}:12`),
      `${'F'.repeat(35)}:3`,
    ].join('\r\n'),
  );

describe('asking whether a password has leaked', () => {
  beforeAll(() => {
    env.PASSWORD_BREACH_CHECK = 'on';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resumeLeakLookups();
    env.PASSWORD_BREACH_CHECK = 'on';
  });
  afterAll(() => {
    env.PASSWORD_BREACH_CHECK = 'off';
    vi.restoreAllMocks();
  });

  it('sends five characters of the hash and nothing more, and finds a leaked password in the answer', async () => {
    const asked = fakeLeakService(leaked(GOOD));
    expect(await foundInLeak(GOOD)).toBe(true);
    expect(await foundInLeak('some other long password')).toBe(false);
    expect(asked[0]).toBe(`https://api.pwnedpasswords.com/range/${sha1(GOOD).slice(0, 5)}`);
    expect(asked.every((url) => /\/range\/[0-9A-F]{5}$/.test(url))).toBe(true);
  });

  it('ignores a padding row, even one that matches', async () => {
    fakeLeakService(() => new Response(`${sha1(GOOD).slice(5)}:0`));
    expect(await foundInLeak(GOOD)).toBe(false);
  });

  it('lets the password through when the service fails, and does not ask again for a while', async () => {
    const asked = fakeLeakService(() => new Response('busy', { status: 503 }));
    expect(await foundInLeak(GOOD)).toBe(false);
    expect(await foundInLeak(GOOD)).toBe(false);
    expect(asked).toHaveLength(1);

    resumeLeakLookups();
    vi.unstubAllGlobals();
    const unreachable = fakeLeakService(() => Promise.reject(new TypeError('fetch failed')));
    expect(await foundInLeak(GOOD)).toBe(false);
    expect(unreachable).toHaveLength(1);
    // What is logged names the problem and never the password or its hash.
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(logged).toMatch(/leaked-password lookup was skipped/);
    expect(logged).not.toContain(GOOD);
    expect(logged).not.toContain(sha1(GOOD).slice(0, 5));
  });

  it('never asks when the setting is off', async () => {
    env.PASSWORD_BREACH_CHECK = 'off';
    const asked = fakeLeakService(leaked(GOOD));
    expect(await foundInLeak(GOOD)).toBe(false);
    expect(asked).toHaveLength(0);
  });
});

describe('setting a password', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  const OLD = 'old pass'; // 8 characters: fine when it was set.
  const LEAKED = 'this one leaked once';

  beforeAll(async () => {
    app = await startApp();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await prisma.user.create({ data: { email: 'old@workshop.test', name: 'Olive Turner', passwordHash: await bcrypt.hash(OLD, 4), emailVerifiedAt: new Date() } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resumeLeakLookups();
    env.PASSWORD_BREACH_CHECK = 'off';
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const user = () => prisma.user.findUniqueOrThrow({ where: { email: 'old@workshop.test' } });
  const register = (email: string, password: string, name = 'New Person') => app.call('POST', '/auth/register', '', { email, password, name });
  const login = (password: string) => app.call('POST', '/auth/login', '', { email: 'old@workshop.test', password });

  it('refuses a weak password when registering, with the reason, and makes no account', async () => {
    const cases: Array<[string, string]> = [
      ['short one', REFUSALS.short],
      [COMMON, REFUSALS.common],
      ['abcabcabcabc', REFUSALS.repeated],
      ['new@workshop.test', REFUSALS.personal],
      ['NewPerson12345', REFUSALS.personal],
    ];
    for (const [password, reason] of cases) {
      const answer = await register('new@workshop.test', password);
      expect(answer.status, password).toBe(400);
      expect(answer.body?.error, password).toBe(reason);
    }
    expect(await prisma.user.findUnique({ where: { email: 'new@workshop.test' } })).toBeNull();
    expect((await register('new@workshop.test', GOOD)).status).toBe(201);
  });

  it('refuses a leaked password when registering, changing and resetting, and asks only once the request is genuine', async () => {
    env.PASSWORD_BREACH_CHECK = 'on';
    const asked = fakeLeakService(leaked(LEAKED));

    const registered = await register('leaky@workshop.test', LEAKED);
    expect(registered.status).toBe(400);
    expect(registered.body?.error).toBe(REFUSALS.leaked);
    expect(asked).toHaveLength(1);
    // An address that is taken is turned away before anything is asked outside.
    expect((await register('old@workshop.test', LEAKED)).status).toBe(409);
    expect(asked).toHaveLength(1);

    const token = signToken(await user());
    // A wrong current password: no outside call. And a 400, never a 401, which the web app reads as "signed out".
    const wrongCurrent = await app.call('POST', '/auth/password', token, { currentPassword: 'not the one', password: LEAKED });
    expect(wrongCurrent.status).toBe(400);
    expect(asked).toHaveLength(1);
    const changed = await app.call('POST', '/auth/password', token, { currentPassword: OLD, password: LEAKED });
    expect(changed.status).toBe(400);
    expect(changed.body?.error).toBe(REFUSALS.leaked);
    expect(asked).toHaveLength(2);

    const reset = await app.call('POST', '/auth/reset', '', { token: signResetToken(await user()), password: LEAKED });
    expect(reset.status).toBe(400);
    expect(reset.body?.error).toBe(REFUSALS.leaked);
    // A dead link: no outside call.
    expect((await app.call('POST', '/auth/reset', '', { token: 'not-a-link', password: LEAKED })).status).toBe(400);
    expect(asked).toHaveLength(3);

    // Nothing above changed the password.
    expect((await login(OLD)).status).toBe(200);
  });

  it('carries on with the built-in list when the service cannot be reached', async () => {
    env.PASSWORD_BREACH_CHECK = 'on';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fakeLeakService(() => Promise.reject(new TypeError('fetch failed')));
    expect((await register('offline-common@workshop.test', COMMON)).status).toBe(400);
    expect((await register('offline@workshop.test', LEAKED)).status).toBe(201);
  });

  it('never applies the rules to signing in, and lets an older, weaker password be changed for a good one', async () => {
    expect((await login(OLD)).status).toBe(200);
    const token = signToken(await user());

    const weak = await app.call('POST', '/auth/password', token, { currentPassword: OLD, password: 'still short' });
    expect(weak.status).toBe(400);
    expect(weak.body?.error).toBe(REFUSALS.short);
    const personal = await app.call('POST', '/auth/password', token, { currentPassword: OLD, password: 'OliveTurner2026' });
    expect(personal.status).toBe(400);
    expect(personal.body?.error).toBe(REFUSALS.personal);
    // The session survived both refusals.
    expect((await app.call('GET', '/auth/me', token)).status).toBe(200);

    expect((await app.call('POST', '/auth/password', token, { currentPassword: OLD, password: GOOD })).status).toBe(200);
    expect((await login(GOOD)).status).toBe(200);
  });

  it('leaves a reset link usable after a refused password', async () => {
    const link = signResetToken(await user());
    const refused = await app.call('POST', '/auth/reset', '', { token: link, password: 'old@workshop.test' });
    expect(refused.status).toBe(400);
    expect(refused.body?.error).toBe(REFUSALS.personal);
    expect((await app.call('POST', '/auth/reset-check', '', { token: link })).status).toBe(204);
    expect((await app.call('POST', '/auth/reset', '', { token: link, password: 'walnut offcuts in a bin' })).status).toBe(200);
    // And once it has worked, it is used up.
    expect((await app.call('POST', '/auth/reset', '', { token: link, password: 'another fine long one' })).status).toBe(400);
  });
});
