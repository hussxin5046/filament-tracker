import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/db';
import { bearerToken, requireAuth, signResetToken, signToken, signTwoStepChallenge, signVerifyToken, userForReset, userForSession, userForTwoStep, userForVerify } from '@/auth';
import { HttpError, parse } from '@/http';
import { rateLimit } from '@/rateLimit';
import { removeUsers, workspacesOnlyOwnedBy } from '@/services/accounts';
import { attemptCounter } from '@/services/attempts';
import { createGuest, GUEST_DAYS, isGuestEmail } from '@/services/guests';
import { appUrl, confirmationRequired, sendMail } from '@/services/mail';
import { requireGoodPassword } from '@/services/passwords';
import { authenticatorLink, base32Encode, looksLikeAppCode, matchingStep, newRecoveryCodes, newSecret, openSecret, recoveryHash, sealSecret } from '@/services/twoStep';

export const authRouter = Router();

const emailField = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));
// A password being set. Its rules (services/passwordRules.ts) are applied by requireGoodPassword in each route
// that takes one, which knows whose password it is and can ask whether it is known from a data leak. They are
// not applied here, so that a refusal is the plain sentence the web app also shows, with no field name in front.
const newPassword = z.string();
// Signing in keeps the old, looser limits: passwords set before today's rules still work.
const credentials = z.object({ email: emailField, password: z.string().min(1).max(200) });
const registration = z.object({ email: emailField, password: newPassword, name: z.string().trim().min(1, 'Enter your name').max(80) });

interface UserRecord {
  id: string;
  email: string;
  name: string;
  isGuest: boolean;
  emailVerifiedAt: Date | null;
  totpEnabledAt: Date | null;
  themeMode: string;
  themePreset: string;
  themeAccent: string | null;
  navLayout: string | null;
  dailyReportAuto: boolean;
}

// Keep in step with NAV_IDS in client/src/lib/navigation.ts.
const NAV_IDS = ['overview', 'inventory', 'locations', 'jobs', 'maintenance', 'machines', 'reorder', 'activity', 'settings'] as const;
const MAX_TAB_BAR = 4;

const uniquePages = (ids: readonly string[]) => new Set(ids).size === ids.length;
/** Pages taken out of one device's navigation. Settings stays, or there would be no way back. */
const hiddenPages = z
  .array(z.enum(NAV_IDS))
  .refine(uniquePages, 'A page can only be hidden once')
  .refine((ids) => !ids.includes('settings'), 'Settings cannot be hidden')
  .default([]);

const navigationInput = z.object({
  /** Null puts the standard layout back. */
  layout: z
    .object({
      order: z
        .array(z.enum(NAV_IDS))
        .refine((ids) => ids.length === NAV_IDS.length && uniquePages(ids), 'List every page exactly once'),
      tabBar: z
        .array(z.enum(NAV_IDS))
        .min(1, 'Keep at least one page in the tab bar')
        .max(MAX_TAB_BAR, `The tab bar holds up to ${MAX_TAB_BAR} pages`)
        .refine(uniquePages, 'A page can only be in the tab bar once'),
      hiddenDesktop: hiddenPages,
      hiddenPhone: hiddenPages,
    })
    .refine((layout) => !layout.tabBar.some((id) => layout.hiddenPhone.includes(id)), 'A page hidden on a phone cannot be in the tab bar')
    .nullable(),
});

const preferencesInput = z.object({ dailyReportAuto: z.boolean() });

/** Stored as text. Anything unreadable counts as "no custom layout"; the client fills gaps from the standard one. */
function readNavLayout(stored: string | null): unknown {
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

const publicUser = (user: UserRecord) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  isGuest: user.isGuest,
  /** False while a registered account still has to open the link sent to its address. */
  emailVerified: user.isGuest || user.emailVerifiedAt !== null || !confirmationRequired(),
  /** Whether signing in also asks for a code from an authenticator app. */
  twoStep: user.totpEnabledAt !== null,
  appearance: { mode: user.themeMode, preset: user.themePreset, accent: user.themeAccent },
  navigation: readNavLayout(user.navLayout),
  dailyReportAuto: user.dailyReportAuto,
});

// Keep in step with PRESETS in client/src/lib/themes.ts.
const THEME_PRESETS = ['graphite', 'slate', 'paper', 'night'] as const;

const appearanceInput = z.object({
  mode: z.enum(['system', 'light', 'dark']),
  preset: z.enum(THEME_PRESETS),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2457b8')
    .transform((hex) => hex.toLowerCase())
    .nullable(),
});

// Per client address. Generous enough for a shared workshop connection, tight enough to stop password guessing.
const loginLimit = rateLimit(20, 15 * 60 * 1000);
const registerLimit = rateLimit(10, 60 * 60 * 1000);
// Each guest session copies the whole example workspace, so these are rationed harder.
const guestLimit = rateLimit(5, 60 * 60 * 1000);
// Both check the current password, so they are guessing targets like sign-in.
const passwordLimit = rateLimit(10, 15 * 60 * 1000);
const forgotLimit = rateLimit(5, 60 * 60 * 1000);
const resetLimit = rateLimit(10, 60 * 60 * 1000);
const resetCheckLimit = rateLimit(30, 60 * 60 * 1000);
// Per email, from any address: stops one account's password being guessed from many connections.
// Kept generous because anyone can use it up for someone else's email, locking them out for a while.
const accountAttempts = attemptCounter('login', 10, 15 * 60 * 1000);
const verifyLimit = rateLimit(30, 60 * 60 * 1000);
const resendLimit = rateLimit(5, 60 * 60 * 1000);

authRouter.post('/register', registerLimit, async (req, res) => {
  const { email, password, name } = parse(registration, req.body);
  if (isGuestEmail(email) || (await prisma.user.findUnique({ where: { email } }))) {
    throw new HttpError(409, 'An account with that email already exists');
  }
  await requireGoodPassword(password, { email, name });
  const passwordHash = await bcrypt.hash(password, 10);

  // A guest who registers keeps the same account, and with it everything they set up.
  const current = await userForSession(bearerToken(req.headers.authorization));

  // Where email cannot be sent, nobody could ever open a link: the address is taken on trust, as it always was.
  const emailVerifiedAt = confirmationRequired() ? null : new Date();
  const user = current?.isGuest
    ? await prisma.user.update({ where: { id: current.id }, data: { email, name, passwordHash, isGuest: false, emailVerifiedAt } })
    : await prisma.user.create({ data: { email, name, passwordHash, emailVerifiedAt } });
  if (!emailVerifiedAt) sendConfirmation(user);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

// ---- Confirming the email address ---------------------------------------------

function sendConfirmation(user: { id: string; email: string; name: string }): void {
  // The token rides in the fragment, which browsers never send to a server, so it stays out of request logs.
  const link = appUrl(`/confirm-email#token=${signVerifyToken(user)}`);
  sendMail({
    to: user.email,
    subject: 'Confirm your email address for Wrkbench',
    text: [
      `Hello ${user.name},`,
      '',
      'An account was made on Wrkbench with this email address. To confirm it is yours, open this link within a day:',
      '',
      link,
      '',
      'Until you do, the account works, but nobody can add it to their workspace.',
      '',
      'If that was not you, ignore this email. Without the link the account can never be confirmed.',
    ].join('\n'),
  });
}

const CONFIRM_LINK_DEAD = 'This link has expired or is not for this account. Sign in and ask for a new one.';

/** Opened from the email, on any device: no sign-in needed, the link is the proof. Opening it twice is fine. */
authRouter.post('/verify', verifyLimit, async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(1).max(2000) }), req.body);
  const user = await userForVerify(token);
  if (!user) throw new HttpError(400, CONFIRM_LINK_DEAD);
  if (!user.emailVerifiedAt) await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  res.json({ email: user.email });
});

const CONFIRM_MAIL_GAP_MS = 2 * 60 * 1000;
const lastConfirmMail = new Map<string, number>();

authRouter.post('/verify/resend', resendLimit, requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  if (user.isGuest) throw new HttpError(400, 'Guest sessions have no email address. Create an account first.');
  if (user.emailVerifiedAt) {
    res.json({ user: publicUser(user), message: 'Your email address is already confirmed.' });
    return;
  }
  const now = Date.now();
  if (now - (lastConfirmMail.get(user.id) ?? 0) < CONFIRM_MAIL_GAP_MS) {
    throw new HttpError(429, 'A link was sent a moment ago. Check your inbox and spam folder, or try again in two minutes.');
  }
  lastConfirmMail.set(user.id, now);
  if (lastConfirmMail.size > 5000) {
    for (const [id, at] of lastConfirmMail) if (now - at > CONFIRM_MAIL_GAP_MS) lastConfirmMail.delete(id);
  }
  sendConfirmation(user);
  res.json({ user: publicUser(user), message: `A new link is on its way to ${user.email}.` });
});

authRouter.post('/login', loginLimit, async (req, res) => {
  const { email, password } = parse(credentials, req.body);
  if (!(await accountAttempts.attempt(email))) {
    throw new HttpError(429, 'Too many sign-in attempts for this email. Wait 15 minutes, or use Forgot password? to choose a new one.');
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  await accountAttempts.clear(email);
  if (user.totpEnabledAt) {
    // The password was only the first step. Nothing that signs in leaves here until a code has been given too.
    res.json({ twoStep: true, challenge: signTwoStepChallenge(user) });
    return;
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.post('/login/two-step', loginLimit, async (req, res) => {
  const { challenge, code } = parse(z.object({ challenge: z.string().min(1).max(2000), code: secondStepCode }), req.body);
  const user = await userForTwoStep(challenge);
  if (!user || !user.totpEnabledAt) throw new HttpError(401, 'That took too long. Sign in again with your password.');
  const how = await takeSecondStep(user.id, user, code);
  if (how === 'recovery') {
    const left = await prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } });
    sendAccountNotice(user, 'A recovery code was used to sign in to Wrkbench', [
      'Someone just signed in to your Wrkbench account with one of your recovery codes instead of your authenticator app.',
      '',
      `You have ${left} recovery code${left === 1 ? '' : 's'} left. You can make a new set under Settings, Account.`,
    ]);
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

/** Try the app without an account: a temporary user with their own copy of the example workspace. */
authRouter.post('/guest', guestLimit, async (_req, res) => {
  const user = await createGuest();
  res.status(201).json({ token: signToken(user, `${GUEST_DAYS}d`), user: publicUser(user) });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  res.json({ user: publicUser(user) });
});

/** A personal preference: any signed-in user, guests included, may set their own. */
authRouter.patch('/me/appearance', requireAuth, async (req, res) => {
  const { mode, preset, accent } = parse(appearanceInput, req.body);
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { themeMode: mode, themePreset: preset, themeAccent: accent },
  });
  res.json({ user: publicUser(user) });
});

/** Also personal: the order of the main navigation, what sits in the phone tab bar, and pages hidden per device. */
authRouter.patch('/me/navigation', requireAuth, async (req, res) => {
  const { layout } = parse(navigationInput, req.body);
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { navLayout: layout ? JSON.stringify(layout) : null },
  });
  res.json({ user: publicUser(user) });
});

/** Also personal: whether the daily report opens by itself on the first visit of the day. */
authRouter.patch('/me/preferences', requireAuth, async (req, res) => {
  const { dailyReportAuto } = parse(preferencesInput, req.body);
  const user = await prisma.user.update({ where: { id: req.userId }, data: { dailyReportAuto } });
  res.json({ user: publicUser(user) });
});

// ---- Password and sessions ---------------------------------------------------

/** The signed-in user, once they have proved they know the current password. Guests have none. */
async function confirmPassword(userId: string, password: unknown) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  if (user.isGuest) throw new HttpError(400, 'Guest sessions have no password. Create an account first.');
  if (typeof password !== 'string' || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  return user;
}

/** Raising the version revokes every token and reset link issued so far. The caller gets a fresh token. */
const revokeSessions = (userId: string, data: { passwordHash?: string; emailVerifiedAt?: Date } = {}) =>
  prisma.user.update({ where: { id: userId }, data: { ...data, tokenVersion: { increment: 1 } } });

/** So that a password changed by someone else does not go unnoticed. */
function sendPasswordChanged(user: { email: string; name: string }): void {
  sendMail({
    to: user.email,
    subject: 'Your Wrkbench password was changed',
    text: [
      `Hello ${user.name},`,
      '',
      'The password for your Wrkbench account was just changed, and every device was signed out.',
      '',
      `If that was you, there is nothing to do. If it was not, choose a new password now: ${appUrl('/forgot-password')}`,
    ].join('\n'),
  });
}

authRouter.post('/password', passwordLimit, requireAuth, async (req, res) => {
  const { currentPassword, password } = parse(z.object({ currentPassword: z.string(), password: newPassword }), req.body);
  const owner = await confirmPassword(req.userId, currentPassword);
  await requireGoodPassword(password, owner);
  const user = await revokeSessions(req.userId, { passwordHash: await bcrypt.hash(password, 10) });
  sendPasswordChanged(user);
  res.json({ token: signToken(user), user: publicUser(user) });
});

/** Signs out every other device; this one carries on with a new token. */
authRouter.post('/sign-out-others', requireAuth, async (req, res) => {
  const user = await revokeSessions(req.userId);
  res.json({ token: signToken(user, user.isGuest ? `${GUEST_DAYS}d` : '30d'), user: publicUser(user) });
});

authRouter.post('/delete-account', passwordLimit, requireAuth, async (req, res) => {
  const user = await confirmPassword(req.userId, req.body?.password);
  const stranded = await workspacesOnlyOwnedBy(user.id);
  if (stranded.length > 0) {
    throw new HttpError(
      409,
      `You are the only owner of ${stranded.map((name) => `"${name}"`).join(', ')}, which other people use. Make someone else an owner or delete it first.`,
    );
  }
  await removeUsers([user.id]);
  res.status(204).end();
});

// ---- Forgotten password ------------------------------------------------------

const RESET_MAIL_GAP_MS = 2 * 60 * 1000;
const lastResetMail = new Map<string, number>();

/** The answer is the same whether or not the address has an account, so this cannot be used to find out who does. */
authRouter.post('/forgot', forgotLimit, async (req, res) => {
  const { email } = parse(z.object({ email: emailField }), req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const now = Date.now();
  if (user && !user.isGuest && now - (lastResetMail.get(user.id) ?? 0) > RESET_MAIL_GAP_MS) {
    lastResetMail.set(user.id, now);
    if (lastResetMail.size > 5000) {
      for (const [id, at] of lastResetMail) if (now - at > RESET_MAIL_GAP_MS) lastResetMail.delete(id);
    }
    // The token rides in the fragment, which browsers never send to a server, so it stays out of request logs.
    const link = appUrl(`/reset-password#token=${signResetToken(user)}`);
    sendMail({
      to: user.email,
      subject: 'Reset your Wrkbench password',
      text: [
        `Hello ${user.name},`,
        '',
        'Someone asked to reset the password for your Wrkbench account. To choose a new one, open this link within an hour:',
        '',
        link,
        '',
        'If that was not you, ignore this email. Your password stays as it is.',
      ].join('\n'),
    });
  }
  res.json({ message: 'If that email has an account, a link to choose a new password is on its way.' });
});

const RESET_LINK_DEAD = 'This link has expired or was already used. Ask for a new one.';

/** Lets the reset page say straight away that a link is used up, instead of after the new password is typed. */
authRouter.post('/reset-check', resetCheckLimit, async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(1).max(2000) }), req.body);
  const user = await userForReset(token);
  if (!user || user.isGuest) throw new HttpError(400, RESET_LINK_DEAD);
  res.status(204).end();
});

authRouter.post('/reset', resetLimit, async (req, res) => {
  const { token, password } = parse(z.object({ token: z.string().min(1).max(2000), password: newPassword }), req.body);
  const user = await userForReset(token);
  if (!user || user.isGuest) throw new HttpError(400, RESET_LINK_DEAD);
  // A refused password leaves the link as it was, to try again with another.
  await requireGoodPassword(password, user);
  // Raising the version makes the link single-use and signs out every device that knew the old password.
  // The link also proved the address is theirs, which is all confirming it asks.
  const updated = await revokeSessions(user.id, {
    passwordHash: await bcrypt.hash(password, 10),
    ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
  });
  sendPasswordChanged(updated);
  // They proved they own the email: a lock-out from earlier guesses should not stop them on another device.
  await accountAttempts.clear(user.email);
  if (updated.totpEnabledAt) {
    // An inbox alone must not get past two-step sign-in: the new password still needs a code with it.
    res.json({ twoStep: true });
    return;
  }
  res.json({ token: signToken(updated), user: publicUser(updated) });
});

// ---- Two-step sign-in ---------------------------------------------------------

/** An authenticator code ("123 456") or a recovery code ("ABCD-EFGH-JKMN"). */
const secondStepCode = z.string().trim().min(6, 'Enter the 6-digit code').max(40);
// Per account, from any address, across signing in and the settings below: five wrong codes in 15 minutes.
const twoStepAttempts = attemptCounter('twostep', 5, 15 * 60 * 1000);
const WRONG_CODE = 'That code is not right. Codes change every 30 seconds, so use the newest one, or a recovery code.';

type TwoStepUser = { id: string; totpSecret: string | null; totpEnabledAt: Date | null; totpLastStep: number | null };

/**
 * Check what was typed against the account's authenticator app, or its unused recovery codes, counting the
 * try. What is accepted is used up in the same step: a code works once.
 * A wrong code is a 401 while signing in. From the settings of someone already signed in it must be a 400:
 * the web app takes a 401 there to mean the session ended, and signs out.
 * The count is kept under `accountId`, passed on its own: the id of whoever is signing in or signed in, never
 * anything derived from a password check.
 */
async function takeSecondStep(accountId: string, user: TwoStepUser, typed: string, wrongStatus: 400 | 401 = 401): Promise<'app' | 'recovery'> {
  if (!(await twoStepAttempts.attempt(accountId))) throw new HttpError(429, 'Too many wrong codes. Wait 15 minutes and try again.');
  let how: 'app' | 'recovery' | null = null;
  if (looksLikeAppCode(typed)) {
    const secret = user.totpSecret ? openSecret(user.totpSecret) : null;
    const step = secret ? matchingStep(secret, typed, user.totpLastStep) : null;
    if (step !== null) {
      // Only if nobody used this code in the meantime.
      const taken = await prisma.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
      if (taken.count === 1) how = 'app';
    }
  } else {
    const taken = await prisma.recoveryCode.updateMany({ where: { userId: user.id, codeHash: recoveryHash(typed), usedAt: null }, data: { usedAt: new Date() } });
    if (taken.count === 1) how = 'recovery';
  }
  if (!how) throw new HttpError(wrongStatus, WRONG_CODE);
  await twoStepAttempts.clear(accountId);
  return how;
}

function sendAccountNotice(user: { email: string; name: string }, subject: string, lines: string[]): void {
  sendMail({
    to: user.email,
    subject,
    text: [`Hello ${user.name},`, '', ...lines, '', `If that was not you, choose a new password now: ${appUrl('/forgot-password')}`].join('\n'),
  });
}

authRouter.get('/two-step', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  const recoveryCodesLeft = user.totpEnabledAt ? await prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } }) : 0;
  res.json({ enabled: user.totpEnabledAt !== null, recoveryCodesLeft });
});

/** Step one of turning it on: a new secret for the authenticator app. Nothing changes for signing in yet. */
authRouter.post('/two-step/setup', passwordLimit, requireAuth, async (req, res) => {
  const user = await confirmPassword(req.userId, req.body?.password);
  if (user.totpEnabledAt) throw new HttpError(409, 'Two-step sign-in is already on');
  if (confirmationRequired() && !user.emailVerifiedAt) {
    throw new HttpError(400, 'Confirm your email address first, with the link Wrkbench emailed you. It is how you get back in if you forget your password.');
  }
  const secret = newSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: sealSecret(secret), totpLastStep: null } });
  res.json({ secret: base32Encode(secret), link: authenticatorLink(user.email, secret) });
});

/** Step two: a first code proves the app is set up. From here on, signing in asks for a code. */
authRouter.post('/two-step/enable', passwordLimit, requireAuth, async (req, res) => {
  const { code } = parse(z.object({ code: secondStepCode }), req.body);
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  if (user.totpEnabledAt) throw new HttpError(409, 'Two-step sign-in is already on');
  const secret = user.totpSecret ? openSecret(user.totpSecret) : null;
  if (!secret) throw new HttpError(409, 'Start setting up two-step sign-in again');
  if (!(await twoStepAttempts.attempt(user.id))) throw new HttpError(429, 'Too many wrong codes. Wait 15 minutes and try again.');
  const step = matchingStep(secret, code, null);
  if (step === null) throw new HttpError(400, 'That code is not right. Check the app shows a Wrkbench code and that your phone\'s clock is right.');
  await twoStepAttempts.clear(user.id);

  const codes = newRecoveryCodes();
  const [, , updated] = await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.recoveryCode.createMany({ data: codes.map(({ hash }) => ({ userId: user.id, codeHash: hash })) }),
    // Other devices signed in with the password alone are signed out; this one carries on with a new token.
    prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, tokenVersion: { increment: 1 } } }),
  ]);
  sendAccountNotice(updated, 'Two-step sign-in is now on for your Wrkbench account', [
    'From now on, signing in to your Wrkbench account asks for a code from your authenticator app as well as your password.',
    '',
    'Keep your recovery codes somewhere safe: each one signs you in once if you lose your phone.',
  ]);
  res.json({ token: signToken(updated), user: publicUser(updated), recoveryCodes: codes.map(({ code: shown }) => shown) });
});

const proof = z.object({ password: z.string(), code: secondStepCode });

authRouter.post('/two-step/disable', passwordLimit, requireAuth, async (req, res) => {
  const { password, code } = parse(proof, req.body);
  const user = await confirmPassword(req.userId, password);
  if (!user.totpEnabledAt) throw new HttpError(409, 'Two-step sign-in is not on');
  await takeSecondStep(req.userId, user, code, 400);
  const [, updated] = await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } }),
  ]);
  sendAccountNotice(updated, 'Two-step sign-in was turned off for your Wrkbench account', [
    'Signing in to your Wrkbench account now needs only your password.',
  ]);
  res.json({ user: publicUser(updated) });
});

/** A fresh set of recovery codes. The old ones stop working. */
authRouter.post('/two-step/recovery-codes', passwordLimit, requireAuth, async (req, res) => {
  const { password, code } = parse(proof, req.body);
  const user = await confirmPassword(req.userId, password);
  if (!user.totpEnabledAt) throw new HttpError(409, 'Two-step sign-in is not on');
  await takeSecondStep(req.userId, user, code, 400);
  const codes = newRecoveryCodes();
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.recoveryCode.createMany({ data: codes.map(({ hash }) => ({ userId: user.id, codeHash: hash })) }),
  ]);
  res.json({ recoveryCodes: codes.map(({ code: shown }) => shown) });
});
