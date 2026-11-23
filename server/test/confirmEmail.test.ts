import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signResetToken, signToken, signVerifyToken } from '@/auth';
import { prisma } from '@/db';
import { env } from '@/env';
import { member, startApp } from './http';

/**
 * Confirming an email address. The tests have no mail server, so emails are printed; the link in one is read
 * back from what was printed, the way a person would read it from their inbox.
 */
let app: Awaited<ReturnType<typeof startApp>>;
let ownerToken: string;
let workspaceId: string;
const printed: string[] = [];

beforeAll(async () => {
  env.EMAIL_CONFIRMATION = 'on';
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => void printed.push(parts.join(' ')));
  app = await startApp();
  workspaceId = (await prisma.workspace.create({ data: { name: 'Demo workshop' } })).id;
  ownerToken = await member('owner@workshop.test', workspaceId, 'owner');
});
afterEach(() => {
  env.EMAIL_CONFIRMATION = 'on';
  printed.length = 0;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
});

const register = (email: string, token = '') => app.call('POST', '/auth/register', token, { email, password: 'a good password', name: 'New Person', ageConfirmed: true });
const addMember = (email: string) => app.call('POST', `/workspaces/${workspaceId}/members`, ownerToken, { email, role: 'operator' });
/** The token in the newest email to this address with this subject. */
function linkToken(to: string, subject: RegExp): string {
  const mail = [...printed].reverse().find((text) => text.includes(`To: ${to}`) && subject.test(text));
  const token = /#token=(\S+)/.exec(mail ?? '')?.[1];
  if (!token) throw new Error(`No email matching ${subject} was sent to ${to}`);
  return token;
}
const mailsTo = (to: string, subject: RegExp) => printed.filter((text) => text.includes(`To: ${to}`) && subject.test(text)).length;

describe('confirming an email address', () => {
  it('refuses to make an account unless age is confirmed', async () => {
    const body = { email: 'young@workshop.test', password: 'a good password', name: 'New Person' };
    expect((await app.call('POST', '/auth/register', '', body)).status).toBe(400);
    expect((await app.call('POST', '/auth/register', '', { ...body, ageConfirmed: false })).status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: body.email } })).toBeNull();
  });

  it('sends a link on registering, and the account cannot be added to a workspace until it is opened', async () => {
    const created = await register('newcomer@workshop.test');
    expect(created.status).toBe(201);
    expect((created.body?.user as { emailVerified: boolean }).emailVerified).toBe(false);

    const refused = await addMember('newcomer@workshop.test');
    expect(refused.status).toBe(409);
    expect(refused.body?.error).toMatch(/has not confirmed its email address/);

    const confirmed = await app.call('POST', '/auth/verify', '', { token: linkToken('newcomer@workshop.test', /Confirm your email/) });
    expect(confirmed).toEqual({ status: 200, body: { email: 'newcomer@workshop.test' } });
    expect(((await app.call('GET', '/auth/me', created.body?.token as string)).body?.user as { emailVerified: boolean }).emailVerified).toBe(true);
    expect((await addMember('newcomer@workshop.test')).status).toBe(201);
  });

  it('lets an unconfirmed account use its own workspaces', async () => {
    const created = await register('solo@workshop.test');
    const made = await app.call('POST', '/workspaces', created.body?.token as string, { name: 'My own bench' });
    expect(made.status).toBe(201);
  });

  it('accepts a link twice, but not one for another address, an expired one, or another kind of token', async () => {
    await register('twice@workshop.test');
    const token = linkToken('twice@workshop.test', /Confirm your email/);
    expect((await app.call('POST', '/auth/verify', '', { token })).status).toBe(200);
    expect((await app.call('POST', '/auth/verify', '', { token })).status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'twice@workshop.test' } });
    const verify = (bad: string) => app.call('POST', '/auth/verify', '', { token: bad });
    const secret = process.env.JWT_SECRET!;
    expect((await verify(signVerifyToken({ id: user.id, email: 'someone-else@workshop.test' }))).status).toBe(400);
    expect((await verify(jwt.sign({ sub: user.id, email: user.email, purpose: 'verify' }, secret, { algorithm: 'HS256', expiresIn: -10 }))).status).toBe(400);
    expect((await verify(signToken(user))).status).toBe(400);
    expect((await verify(signResetToken(user))).status).toBe(400);
    // And a confirmation link is never a way to sign in.
    expect((await app.call('GET', '/auth/me', signVerifyToken(user))).status).toBe(401);
  });

  it('sends a new link when asked, at most one every two minutes, and none once confirmed', async () => {
    const created = await register('again@workshop.test');
    const token = created.body?.token as string;
    // The one sent on registering does not count against asking again.
    const first = await app.call('POST', '/auth/verify/resend', token);
    expect(first.status).toBe(200);
    expect(mailsTo('again@workshop.test', /Confirm your email/)).toBe(2);
    expect((await app.call('POST', '/auth/verify/resend', token)).status).toBe(429);
    expect(mailsTo('again@workshop.test', /Confirm your email/)).toBe(2);

    await app.call('POST', '/auth/verify', '', { token: linkToken('again@workshop.test', /Confirm your email/) });
    const done = await app.call('POST', '/auth/verify/resend', token);
    expect(done.body?.message).toMatch(/already confirmed/);
    expect(mailsTo('again@workshop.test', /Confirm your email/)).toBe(2);
    expect((await app.call('POST', '/auth/verify/resend', '')).status).toBe(401);
  });

  it('counts a password reset as confirming, since the reset link went to the same address', async () => {
    await register('forgetful@workshop.test');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'forgetful@workshop.test' } });
    expect(user.emailVerifiedAt).toBeNull();
    expect((await app.call('POST', '/auth/reset', '', { token: signResetToken(user), password: 'another password' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    expect((await addMember('forgetful@workshop.test')).status).toBe(201);
  });

  it('asks a guest who registers to confirm too, and has nothing to send a guest', async () => {
    const guest = await app.call('POST', '/auth/guest', '');
    const guestToken = guest.body?.token as string;
    expect((guest.body?.user as { emailVerified: boolean }).emailVerified).toBe(true);
    expect((await app.call('POST', '/auth/verify/resend', guestToken)).status).toBe(400);

    const kept = await register('was-a-guest@workshop.test', guestToken);
    expect((kept.body?.user as { emailVerified: boolean }).emailVerified).toBe(false);
    expect(mailsTo('was-a-guest@workshop.test', /Confirm your email/)).toBe(1);
  });

  it('asks for nothing where confirmation is off, as on a server that cannot send email', async () => {
    env.EMAIL_CONFIRMATION = 'auto'; // the tests have no mail settings
    const created = await register('offline@workshop.test');
    expect((created.body?.user as { emailVerified: boolean }).emailVerified).toBe(true);
    expect(mailsTo('offline@workshop.test', /Confirm your email/)).toBe(0);
    expect((await addMember('offline@workshop.test')).status).toBe(201);
  });
});

describe('a changed password', () => {
  it('is reported to the account by email, whether changed while signed in or through a reset link', async () => {
    const user = await prisma.user.create({ data: { email: 'careful@workshop.test', name: 'Careful', passwordHash: await bcrypt.hash('the old password', 4), emailVerifiedAt: new Date() } });
    const changed = await app.call('POST', '/auth/password', signToken(user), { currentPassword: 'the old password', password: 'the new password' });
    expect(changed.status).toBe(200);
    expect(mailsTo('careful@workshop.test', /password was changed/)).toBe(1);

    const now = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await app.call('POST', '/auth/reset', '', { token: signResetToken(now), password: 'a third password' });
    expect(mailsTo('careful@workshop.test', /password was changed/)).toBe(2);

    // A wrong current password changes nothing and sends nothing.
    const latest = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect((await app.call('POST', '/auth/password', signToken(latest), { currentPassword: 'not it', password: 'whatever else' })).status).toBe(400);
    expect(mailsTo('careful@workshop.test', /password was changed/)).toBe(2);
  });
});
