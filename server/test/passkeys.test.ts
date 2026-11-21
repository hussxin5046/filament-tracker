import bcrypt from 'bcryptjs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { signResetToken, signToken } from '@/auth';
import { prisma } from '@/db';
import { env } from '@/env';
import { removeUsers } from '@/services/accounts';
import { passkeySiteFrom } from '@/services/passkeySite';
import { finishAdding, finishSigningIn, forgetOldChallenges, MAX_PASSKEYS, passkeySite, startAdding, startSigningIn } from '@/services/passkeys';
import { codeFor, sealSecret, stepAt } from '@/services/twoStep';
import { FakePasskey } from './fakeAuthenticator';
import { startApp } from './http';

describe('the site passkeys are tied to', () => {
  it('is the host name Wrkbench is reached at, from APP_URL or else CLIENT_ORIGIN', () => {
    expect(passkeySiteFrom({ CLIENT_ORIGIN: 'http://localhost:5173' })).toEqual({ id: 'localhost', origins: ['http://localhost:5173'] });
    expect(passkeySiteFrom({ CLIENT_ORIGIN: 'https://filament-trackerserver-staging.up.railway.app' })).toEqual({
      id: 'filament-trackerserver-staging.up.railway.app',
      origins: ['https://filament-trackerserver-staging.up.railway.app'],
    });
    // APP_URL names the site; CLIENT_ORIGIN is accepted as well when it is the same site.
    expect(passkeySiteFrom({ APP_URL: 'https://www.wrkbench.xyz/', CLIENT_ORIGIN: 'https://www.wrkbench.xyz' })).toEqual({ id: 'www.wrkbench.xyz', origins: ['https://www.wrkbench.xyz'] });
    // An address that belongs to another site is not somewhere a passkey may be used from.
    expect(passkeySiteFrom({ APP_URL: 'https://www.wrkbench.xyz', CLIENT_ORIGIN: 'http://localhost:5173' })).toEqual({ id: 'www.wrkbench.xyz', origins: ['https://www.wrkbench.xyz'] });
  });

  it('can be widened to a parent with PASSKEY_SITE, and to nothing else', () => {
    expect(passkeySiteFrom({ APP_URL: 'https://www.wrkbench.xyz', CLIENT_ORIGIN: 'https://wrkbench.xyz', PASSKEY_SITE: 'Wrkbench.xyz' })).toEqual({
      id: 'wrkbench.xyz',
      origins: ['https://www.wrkbench.xyz', 'https://wrkbench.xyz'],
    });
    // Production and staging are different sites: neither can be set to the other, so a passkey never crosses.
    expect(passkeySiteFrom({ CLIENT_ORIGIN: 'https://filament-trackerserver-staging.up.railway.app', PASSKEY_SITE: 'wrkbench.xyz' })).toMatch(/must be the host name/);
    expect(passkeySiteFrom({ CLIENT_ORIGIN: 'https://www.wrkbench.xyz', PASSKEY_SITE: 'notwrkbench.xyz' })).toMatch(/must be the host name/);
    expect(passkeySiteFrom({ CLIENT_ORIGIN: 'https://www.wrkbench.xyz', PASSKEY_SITE: 'xyz' })).toMatch(/on its own/);
    expect(passkeySiteFrom({ CLIENT_ORIGIN: 'https://www.wrkbench.xyz', PASSKEY_SITE: 'https://wrkbench.xyz' })).toMatch(/host name only/);
  });

  it('is nowhere when Wrkbench is reached by a number, where browsers have no passkeys', () => {
    expect(passkeySiteFrom({ CLIENT_ORIGIN: 'http://192.168.1.20:4000' })).toBeNull();
    expect(passkeySiteFrom({ CLIENT_ORIGIN: 'not an address' })).toBeNull();
    expect(passkeySiteFrom({ CLIENT_ORIGIN: 'http://192.168.1.20:4000', PASSKEY_SITE: 'example.com' })).toMatch(/address with a name/);
  });
});

describe('passkeys', () => {
  const PASSWORD = 'nine quiet lathes hum';
  const ORIGIN = 'http://localhost:5173';
  let app: Awaited<ReturnType<typeof startApp>>;
  const printed: string[] = [];
  const site = passkeySite()!;

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => void printed.push(parts.join(' ')));
    app = await startApp();
  });
  afterEach(() => {
    printed.length = 0;
    env.EMAIL_CONFIRMATION = 'auto';
    vi.useRealTimers();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const mailsTo = (to: string, subject: RegExp) => printed.filter((text) => text.includes(`To: ${to}`) && subject.test(text)).length;
  const device = (options: Partial<FakePasskey['options']> = {}) => new FakePasskey({ origin: ORIGIN, site: 'localhost', ...options });
  const post = (path: string, token: string, body?: unknown) => app.call('POST', path, token, body ?? {});

  async function account(email: string, data: Record<string, unknown> = {}) {
    const user = await prisma.user.create({ data: { email, name: 'Demo Maker', passwordHash: await bcrypt.hash(PASSWORD, 4), emailVerifiedAt: new Date(), ...data } });
    return { user, token: signToken(user) };
  }
  /** Add a passkey the way the settings page does: password, then the device's answer. */
  async function add(token: string, passkey: FakePasskey, name = 'Test phone') {
    const start = await post('/auth/passkeys/add/start', token, { password: PASSWORD });
    expect(start.status).toBe(200);
    return post('/auth/passkeys/add/finish', token, { response: passkey.create(start.body?.options as never), name });
  }
  /** Add one without going through the routes, for tests about the device's answer and not about who may ask. */
  async function addDirectly(user: { id: string; email: string; name: string }, passkey: FakePasskey) {
    const options = await startAdding(site, user);
    return finishAdding(site, user.id, passkey.create(options) as unknown as RegistrationResponseJSON, 'Test phone');
  }
  /** What the server makes of this device signing in: the account, or null. */
  async function signInDirectly(passkey: FakePasskey) {
    const options = await startSigningIn(site);
    return finishSigningIn(site, passkey.get(options) as unknown as AuthenticationResponseJSON);
  }

  it('is added with the password, listed, and then signs in by itself', async () => {
    const { user, token } = await account('adds@workshop.test');
    const passkey = device();

    // A wrong password is a 400, never a 401: the web app reads a 401 as "signed out".
    const wrong = await post('/auth/passkeys/add/start', token, { password: 'not the password' });
    expect(wrong.status).toBe(400);
    expect((await app.call('GET', '/auth/me', token)).status).toBe(200);

    const start = await post('/auth/passkeys/add/start', token, { password: PASSWORD });
    expect(start.status).toBe(200);
    const options = start.body?.options as { rp: { id: string }; authenticatorSelection: Record<string, string>; attestation: string; user: { name: string } };
    expect(options.rp.id).toBe('localhost');
    // The device must check its owner, and must be able to offer the passkey without an email being typed.
    expect(options.authenticatorSelection).toMatchObject({ userVerification: 'required', residentKey: 'required' });
    expect(options.user.name).toBe('adds@workshop.test');

    const added = await post('/auth/passkeys/add/finish', token, { response: passkey.create(options as never), name: 'Workshop laptop' });
    expect(added.status).toBe(201);
    expect(mailsTo('adds@workshop.test', /passkey was added/)).toBe(1);
    expect(printed.join('\n')).toContain('"Workshop laptop"');

    const listed = await app.call('GET', '/auth/passkeys', token);
    expect(listed.body).toMatchObject({ available: true, passkeys: [{ name: 'Workshop laptop', worksHere: true, lastUsedAt: null }] });
    // Nothing of the key itself is ever sent back.
    expect(JSON.stringify(listed.body)).not.toMatch(/publicKey|credentialId|counter/);

    // Signing in: no email, no password, no token.
    const challenge = await post('/auth/passkeys/sign-in/start', '');
    expect(challenge.status).toBe(200);
    expect(challenge.body?.options).toMatchObject({ rpId: 'localhost', userVerification: 'required' });
    expect((challenge.body?.options as { allowCredentials?: unknown[] }).allowCredentials ?? []).toHaveLength(0);
    const signedIn = await post('/auth/passkeys/sign-in/finish', '', { response: passkey.get(challenge.body?.options as never) });
    expect(signedIn.status).toBe(200);
    expect((signedIn.body?.user as { email: string }).email).toBe('adds@workshop.test');
    expect((await app.call('GET', '/auth/me', signedIn.body?.token as string)).status).toBe(200);
    expect((await prisma.passkey.findFirstOrThrow({ where: { userId: user.id } })).lastUsedAt).not.toBeNull();
  });

  it('counts as both steps: no code is asked, though adding one needed a code', async () => {
    const secret = Buffer.from('12345678901234567890');
    const { token } = await account('twostep@workshop.test', { totpSecret: sealSecret(secret), totpEnabledAt: new Date() });
    const passkey = device();

    // With two-step sign-in on, the password alone does not add a passkey, and a wrong code does not either.
    const noCode = await post('/auth/passkeys/add/start', token, { password: PASSWORD });
    expect(noCode.status).toBe(400);
    expect(noCode.body?.error).toMatch(/code from your authenticator app/);
    const wrongCode = await post('/auth/passkeys/add/start', token, { password: PASSWORD, code: '000000' });
    expect(wrongCode.status).toBe(400);
    expect((await app.call('GET', '/auth/me', token)).status).toBe(200);
    expect(await prisma.passkeyChallenge.count({ where: { purpose: 'add' } })).toBe(0);

    const start = await post('/auth/passkeys/add/start', token, { password: PASSWORD, code: codeFor(secret, stepAt(Date.now())) });
    expect(start.status).toBe(200);
    expect((await post('/auth/passkeys/add/finish', token, { response: passkey.create(start.body?.options as never), name: 'Phone' })).status).toBe(201);

    // The password still only gets as far as the code step.
    const password = await post('/auth/login', '', { email: 'twostep@workshop.test', password: PASSWORD });
    expect(password.body).toMatchObject({ twoStep: true });
    expect(password.body?.token).toBeUndefined();
    // The passkey goes straight in.
    const challenge = await post('/auth/passkeys/sign-in/start', '');
    const signedIn = await post('/auth/passkeys/sign-in/finish', '', { response: passkey.get(challenge.body?.options as never) });
    expect(signedIn.status).toBe(200);
    expect(typeof signedIn.body?.token).toBe('string');
  });

  it('refuses guests and accounts that have not confirmed their email', async () => {
    const guest = await post('/auth/guest', '');
    const asGuest = await post('/auth/passkeys/add/start', guest.body?.token as string, { password: 'anything at all' });
    expect(asGuest.status).toBe(400);
    expect(asGuest.body?.error).toMatch(/Guest sessions/);

    env.EMAIL_CONFIRMATION = 'on';
    const { user, token } = await account('unconfirmed@workshop.test', { emailVerifiedAt: null });
    const unconfirmed = await post('/auth/passkeys/add/start', token, { password: PASSWORD });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body?.error).toMatch(/Confirm your email address first/);
    expect(await prisma.passkeyChallenge.count({ where: { userId: user.id } })).toBe(0);
    expect((await app.call('GET', '/auth/passkeys', '')).status).toBe(401);
  });

  it('refuses a passkey whose counter goes backwards or stands still', async () => {
    const { user } = await account('counter@workshop.test');
    const passkey = device();
    expect(await addDirectly(user, passkey)).not.toBeNull();
    const stored = () => prisma.passkey.findUniqueOrThrow({ where: { credentialId: passkey.id.toString('base64url') } });

    expect((await signInDirectly(passkey))?.id).toBe(user.id);
    expect((await signInDirectly(passkey))?.id).toBe(user.id);
    expect((await stored()).counter).toBe(2n);

    // A copy of the device, made earlier, signs with an older count.
    passkey.counter = 0;
    expect(await signInDirectly(passkey)).toBeNull();
    // The same count again is no better.
    passkey.counter = 1;
    expect(await signInDirectly(passkey)).toBeNull();
    expect((await stored()).counter).toBe(2n);
    // The real device, which has moved on, still works.
    passkey.counter = 5;
    expect((await signInDirectly(passkey))?.id).toBe(user.id);
    expect((await stored()).counter).toBe(6n);

    // Over HTTP the refusal is the same answer as for any other failure.
    passkey.counter = 2;
    const challenge = await post('/auth/passkeys/sign-in/start', '');
    const refused = await post('/auth/passkeys/sign-in/finish', '', { response: passkey.get(challenge.body?.options as never) });
    expect(refused.status).toBe(401);
    expect(refused.body?.error).toBe('That passkey was not accepted. Sign in with your password instead.');
  });

  it('lets a synced passkey, which always reports a counter of 0, sign in again and again', async () => {
    const { user } = await account('synced@workshop.test');
    const passkey = device({ synced: true });
    const added = await addDirectly(user, passkey);
    expect(added?.synced).toBe(true);
    expect((await signInDirectly(passkey))?.id).toBe(user.id);
    expect((await signInDirectly(passkey))?.id).toBe(user.id);
  });

  it('takes each challenge once, for five minutes, and only for what it was handed out for', async () => {
    const { user } = await account('challenge@workshop.test');
    const other = await account('other@workshop.test');
    const passkey = device({ synced: true });
    await addDirectly(user, passkey);

    // The same answer sent twice: the second is refused.
    const options = await startSigningIn(site);
    const answer = passkey.get(options) as unknown as AuthenticationResponseJSON;
    expect((await finishSigningIn(site, answer))?.id).toBe(user.id);
    expect(await finishSigningIn(site, answer)).toBeNull();

    // An answer that arrives after five minutes.
    const late = await startSigningIn(site);
    await prisma.passkeyChallenge.updateMany({ where: { challenge: late.challenge }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await finishSigningIn(site, passkey.get(late) as unknown as AuthenticationResponseJSON)).toBeNull();
    expect(await forgetOldChallenges()).toBe(1);

    // A challenge handed to one account for adding a passkey is no use to another account, or for signing in.
    const forUser = await startAdding(site, user);
    expect(await finishAdding(site, other.user.id, device().create(forUser) as unknown as RegistrationResponseJSON, 'Stolen')).toBeNull();
    const forAdding = await startAdding(site, user);
    expect(await finishSigningIn(site, passkey.get(forAdding) as unknown as AuthenticationResponseJSON)).toBeNull();
    // And one made up by the caller is no use at all.
    expect(await finishSigningIn(site, passkey.get({ challenge: 'bWFkZS11cA' }) as unknown as AuthenticationResponseJSON)).toBeNull();
    expect(await prisma.passkey.count({ where: { userId: other.user.id } })).toBe(0);
  });

  it('refuses a device that does not check its owner, another site, and another address', async () => {
    const { user } = await account('strict@workshop.test');
    // Made without the fingerprint or PIN check.
    expect(await addDirectly(user, device({ verifiesUser: false }))).toBeNull();
    // Made for, or from, somewhere else.
    expect(await addDirectly(user, device({ site: 'www.wrkbench.xyz' }))).toBeNull();
    expect(await addDirectly(user, device({ origin: 'https://evil.example' }))).toBeNull();
    expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(0);

    const passkey = device({ synced: true });
    expect(await addDirectly(user, passkey)).not.toBeNull();
    passkey.options = { ...passkey.options, verifiesUser: false };
    expect(await signInDirectly(passkey)).toBeNull();
    passkey.options = { ...passkey.options, verifiesUser: true, origin: 'https://evil.example' };
    expect(await signInDirectly(passkey)).toBeNull();
    passkey.options = { ...passkey.options, origin: ORIGIN, site: 'www.wrkbench.xyz' };
    expect(await signInDirectly(passkey)).toBeNull();
    passkey.options = { ...passkey.options, site: 'localhost' };
    expect((await signInDirectly(passkey))?.id).toBe(user.id);

    // A device nobody has added.
    expect(await signInDirectly(device())).toBeNull();
  });

  it('does not offer or accept a passkey made for another site, such as staging on production', async () => {
    const { user, token } = await account('moved@workshop.test');
    const passkey = device({ synced: true });
    const added = await addDirectly(user, passkey);
    await prisma.passkey.update({ where: { id: added!.id }, data: { site: 'filament-trackerserver-staging.up.railway.app' } });

    expect(await signInDirectly(passkey)).toBeNull();
    const listed = await app.call('GET', '/auth/passkeys', token);
    expect(listed.body?.passkeys).toMatchObject([{ worksHere: false }]);
    // It can still be removed.
    expect((await app.call('DELETE', `/auth/passkeys/${added!.id}`, token)).status).toBe(200);
  });

  it('is renamed and removed by its owner only, the last one included, with an email each time one goes', async () => {
    const { user, token } = await account('owner@workshop.test');
    const stranger = await account('stranger@workshop.test');
    const first = await addDirectly(user, device());
    const second = await addDirectly(user, device());

    expect((await app.call('PATCH', `/auth/passkeys/${first!.id}`, stranger.token, { name: 'Mine now' })).status).toBe(404);
    expect((await app.call('DELETE', `/auth/passkeys/${first!.id}`, stranger.token)).status).toBe(404);
    expect((await app.call('PATCH', `/auth/passkeys/${first!.id}`, token, { name: '   ' })).status).toBe(400);

    const renamed = await app.call('PATCH', `/auth/passkeys/${first!.id}`, token, { name: 'Bench tablet' });
    expect(renamed.body?.passkeys).toMatchObject([{ name: 'Bench tablet' }, { name: 'Test phone' }]);

    expect((await app.call('DELETE', `/auth/passkeys/${first!.id}`, token)).status).toBe(200);
    const none = await app.call('DELETE', `/auth/passkeys/${second!.id}`, token);
    expect(none.body?.passkeys).toEqual([]);
    expect(mailsTo('owner@workshop.test', /passkey was removed/)).toBe(2);
    expect(printed.join('\n')).toContain('"Bench tablet"');
    // The account is as it was: the password signs in.
    expect((await post('/auth/login', '', { email: 'owner@workshop.test', password: PASSWORD })).status).toBe(200);
  });

  it('stops at ten passkeys, and one device cannot be added twice', async () => {
    const { user, token } = await account('many@workshop.test');
    const passkey = device();
    expect((await add(token, passkey)).status).toBe(201);

    // The device is told which passkeys exist, so it can say "already here" itself; the server refuses too.
    const again = await post('/auth/passkeys/add/start', token, { password: PASSWORD });
    expect((again.body?.options as { excludeCredentials: Array<{ id: string }> }).excludeCredentials).toEqual([expect.objectContaining({ id: passkey.id.toString('base64url') })]);
    const twice = await post('/auth/passkeys/add/finish', token, { response: passkey.create(again.body?.options as never), name: 'Again' });
    expect(twice.status).toBe(409);

    for (let i = 1; i < MAX_PASSKEYS; i++) expect(await addDirectly(user, device())).not.toBeNull();
    const full = await post('/auth/passkeys/add/start', token, { password: PASSWORD });
    expect(full.status).toBe(400);
    expect(full.body?.error).toMatch(/up to 10 passkeys/);
  });

  it('is left alone by a password reset, which still does not get an inbox past two-step sign-in', async () => {
    const secret = Buffer.from('12345678901234567890');
    const { user } = await account('reset@workshop.test', { totpSecret: sealSecret(secret), totpEnabledAt: new Date() });
    const passkey = device({ synced: true });
    await addDirectly(user, passkey);

    const reset = await post('/auth/reset', '', { token: signResetToken(user), password: 'walnut offcuts in a bin' });
    expect(reset.status).toBe(200);
    // Still no session from the emailed link alone.
    expect(reset.body).toEqual({ twoStep: true });
    expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(1);
    // The passkey still signs in, and signing out everywhere (which the reset did) does not remove it.
    expect((await signInDirectly(passkey))?.id).toBe(user.id);

    // Changing the password and signing out other devices leave it too.
    const now = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect((await post('/auth/sign-out-others', signToken(now))).status).toBe(200);
    expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(1);
  });

  it('goes with the account when the account is deleted', async () => {
    const { user } = await account('leaving@workshop.test');
    const passkey = device({ synced: true });
    await addDirectly(user, passkey);
    // What "Delete my account" runs, called directly: this file has used up its allowance of password checks.
    await removeUsers([user.id]);
    expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(0);
    expect(await signInDirectly(passkey)).toBeNull();
  });
});
