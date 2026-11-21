import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signResetToken, signToken } from '@/auth';
import { prisma } from '@/db';
import { attemptCounter, forgetOldAttempts } from '@/services/attempts';
import { startApp } from './http';

describe('counting sign-in attempts per account', () => {
  const MIN = 60_000;
  const T0 = Date.UTC(2026, 0, 1);

  it('allows the allowance, refuses the next, and forgets attempts once they are old', async () => {
    const counter = attemptCounter('test-a', 3, 15 * MIN);
    for (const i of [0, 1, 2]) expect(await counter.attempt('a@x.test', T0 + i * MIN)).toBe(true);
    expect(await counter.attempt('a@x.test', T0 + 3 * MIN)).toBe(false);
    // Each account has its own allowance.
    expect(await counter.attempt('b@x.test', T0 + 3 * MIN)).toBe(true);
    // A refused attempt is not recorded, so the lock lifts 15 minutes after the first attempt.
    expect(await counter.attempt('a@x.test', T0 + 15 * MIN)).toBe(true);
  });

  it('starts again once the account has proved who it is', async () => {
    const counter = attemptCounter('test-b', 2, 15 * MIN);
    await counter.attempt('a@x.test', T0);
    await counter.attempt('a@x.test', T0 + 1);
    expect(await counter.attempt('a@x.test', T0 + 2)).toBe(false);
    await counter.clear('a@x.test');
    expect(await counter.attempt('a@x.test', T0 + 3)).toBe(true);
  });

  it('remembers across a restart, because the count is in the database and not in memory', async () => {
    const before = attemptCounter('test-c', 2, 15 * MIN);
    await before.attempt('victim@x.test', T0);
    await before.attempt('victim@x.test', T0 + 1);
    // What a new server process starts with: a counter that has seen nothing itself.
    const after = attemptCounter('test-c', 2, 15 * MIN);
    expect(await after.attempt('victim@x.test', T0 + 2)).toBe(false);
  });

  it('counts attempts made at the same moment, and keeps one kind of attempt apart from another', async () => {
    const counter = attemptCounter('test-d', 3, 15 * MIN);
    const results = await Promise.all(Array.from({ length: 8 }, () => counter.attempt('a@x.test', T0)));
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(await attemptCounter('test-e', 3, 15 * MIN).attempt('a@x.test', T0)).toBe(true);
  });

  it('stores a fingerprint of the address, never the address, and sweeps out old attempts', async () => {
    // The tests above used a clock set in the past: start from nothing.
    await prisma.signInAttempt.deleteMany();
    const counter = attemptCounter('test-f', 3, 15 * MIN);
    await counter.attempt('someone-private@x.test', Date.now() - 3 * 24 * 60 * MIN);
    await counter.attempt('someone-private@x.test');
    const rows = await prisma.signInAttempt.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.key.includes('someone-private'))).toBe(false);
    expect(await forgetOldAttempts()).toBe(1);
    expect(await prisma.signInAttempt.count()).toBe(1);
  });
});

describe('signing in', () => {
  const email = 'guessed@example.test';
  const PASSWORD = 'correct horse battery';
  let app: Awaited<ReturnType<typeof startApp>>;
  let userId: string;

  beforeAll(async () => {
    app = await startApp();
    const user = await prisma.user.create({ data: { email, name: 'Guessed', passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    userId = user.id;
  });
  afterAll(() => app.close());

  const login = (password: string) => app.call('POST', '/auth/login', '', { email, password });

  // Every /login here comes from one address, whose own limit is 20 per 15 minutes: this file stays under it.
  it('clears earlier mistakes once the right password is given', async () => {
    expect((await login('wrong password 1')).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(200);
  });

  it('takes new passwords of up to 72 bytes, and still signs in with a longer one set before that limit', async () => {
    const register = (address: string, password: string) => app.call('POST', '/auth/register', '', { email: address, password, name: 'New' });
    const fits = 'correct horse battery staple '.repeat(3).slice(0, 72);
    expect((await register('ascii72@example.test', fits)).status).toBe(201);
    const tooLong = await register('ascii73@example.test', `${fits}x`);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body?.error).toMatch(/at most 72 characters/);
    // 19 emoji are 19 characters but 76 bytes.
    expect((await register('emoji@example.test', '🔧'.repeat(19))).status).toBe(400);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ascii72@example.test' } });
    const tooLongReset = await app.call('POST', '/auth/reset', '', { token: signResetToken(user), password: 'b'.repeat(73) });
    expect(tooLongReset.status).toBe(400);

    const old = 'an old password from before the limit '.repeat(3);
    await prisma.user.create({ data: { email: 'longpass@example.test', name: 'Old', passwordHash: await bcrypt.hash(old, 4) } });
    expect((await app.call('POST', '/auth/login', '', { email: 'longpass@example.test', password: old })).status).toBe(200);
  });

  it('accepts only sign-in tokens made with the one algorithm the server uses', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const claims = { sub: user.id, v: user.tokenVersion };
    const secret = process.env.JWT_SECRET!;
    expect((await app.call('GET', '/auth/me', signToken(user))).status).toBe(200);
    expect((await app.call('GET', '/auth/me', jwt.sign(claims, secret, { algorithm: 'HS512' }))).status).toBe(401);
    expect((await app.call('GET', '/auth/me', jwt.sign(claims, null, { algorithm: 'none' }))).status).toBe(401);
  });

  it('locks the account after 10 wrong passwords, even for the right one, until a password reset', async () => {
    for (let i = 0; i < 10; i++) expect((await login(`wrong password ${i}`)).status).toBe(401);
    const locked = await login(PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body?.error).toMatch(/Too many sign-in attempts for this email/);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const reset = await app.call('POST', '/auth/reset', '', { token: signResetToken(user), password: 'a brand new password' });
    expect(reset.status).toBe(200);
    expect((await login('a brand new password')).status).toBe(200);
  });
});
