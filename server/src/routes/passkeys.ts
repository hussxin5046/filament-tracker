import { Router } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { requireAuth, signToken } from '@/auth';
import { prisma } from '@/db';
import { HttpError, notFound, param, parse } from '@/http';
import { rateLimit } from '@/rateLimit';
import { confirmPassword, loginLimit, passwordLimit, publicUser, secondStepCode, sendAccountNotice, takeSecondStep } from '@/routes/auth';
import { attemptCounter } from '@/services/attempts';
import { confirmationRequired } from '@/services/mail';
import { finishAdding, finishSigningIn, MAX_PASSKEYS, passkeySite, publicPasskey, startAdding, startSigningIn } from '@/services/passkeys';

/**
 * Passkeys, under /api/auth/passkeys. Adding, naming and removing them is for the signed-in member, about
 * their own account only. The two sign-in routes are for anyone: they are how a passkey signs someone in.
 */
export const passkeysRouter = Router();

// The device's answers are checked by the library; here they only have to be the right shape and a sane size.
const text = z.string().min(1).max(20_000);
const deviceAnswer = z.looseObject({ id: text, rawId: text, type: z.literal('public-key'), response: z.looseObject({ clientDataJSON: text }) });
const passkeyName = z.string().trim().min(1, 'Give the passkey a name').max(60, 'Use a name of at most 60 characters');

// Per address. Reading, naming and removing are not guessing targets, but nothing here should be hammered.
const manageLimit = rateLimit(60, 15 * 60 * 1000);
// Per account, from any address: wrong passwords typed into "Add a passkey". Kept under the session's account id.
const addAttempts = attemptCounter('passkey-add', 10, 15 * 60 * 1000);

const NOT_HERE = 'Passkeys cannot be used at this address. Wrkbench has to be opened at a named address, not a number.';
const NOT_ACCEPTED = 'That passkey was not accepted. Sign in with your password instead.';

function siteOrRefuse() {
  const site = passkeySite();
  if (!site) throw new HttpError(400, NOT_HERE);
  return site;
}

const listFor = async (userId: string) => {
  const site = passkeySite();
  const passkeys = await prisma.passkey.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return passkeys.map((passkey) => publicPasskey(site, passkey));
};

passkeysRouter.get('/', manageLimit, requireAuth, async (req, res) => {
  res.json({ available: passkeySite() !== null, max: MAX_PASSKEYS, passkeys: await listFor(req.userId) });
});

/**
 * Step one of adding: prove it is you, with the password and, where two-step sign-in is on, a code as well.
 * A passkey gets its holder past both from then on, so adding one asks for both.
 * Wrong answers are a 400: the web app takes a 401 from a signed-in request to mean the session ended.
 */
passkeysRouter.post('/add/start', passwordLimit, requireAuth, async (req, res) => {
  const { password, code } = parse(z.object({ password: z.string(), code: secondStepCode.optional() }), req.body);
  const site = siteOrRefuse();
  if (!(await addAttempts.attempt(req.userId))) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes and try again.');
  const user = await confirmPassword(req.userId, password);
  await addAttempts.clear(req.userId);
  if (confirmationRequired() && !user.emailVerifiedAt) {
    throw new HttpError(400, 'Confirm your email address first, with the link Wrkbench emailed you. It is how you get back in if you lose the device.');
  }
  if (user.totpEnabledAt) {
    if (!code) throw new HttpError(400, 'Enter a code from your authenticator app as well.');
    await takeSecondStep(req.userId, user, code, 400);
  }
  if ((await prisma.passkey.count({ where: { userId: user.id } })) >= MAX_PASSKEYS) {
    throw new HttpError(400, `An account can have up to ${MAX_PASSKEYS} passkeys. Remove one you no longer use first.`);
  }
  res.json({ options: await startAdding(site, user) });
});

/** Step two: the device's answer. Only good for a challenge step one handed to this same account. */
passkeysRouter.post('/add/finish', manageLimit, requireAuth, async (req, res) => {
  const { response, name } = parse(z.object({ response: deviceAnswer, name: passkeyName }), req.body);
  const site = siteOrRefuse();
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(401, 'Please sign in');
  if (user.isGuest) throw new HttpError(400, 'Guest sessions cannot have passkeys. Create an account first.');
  if (await prisma.passkey.findUnique({ where: { credentialId: response.id } })) {
    throw new HttpError(409, 'This device already has a passkey for Wrkbench.');
  }
  const passkey = await finishAdding(site, user.id, response as unknown as RegistrationResponseJSON, name);
  if (!passkey) throw new HttpError(400, 'The passkey could not be added. Press Add a passkey to try again.');
  sendAccountNotice(user, 'A passkey was added to your Wrkbench account', [
    `A passkey called "${passkey.name}" was just added to your Wrkbench account. It signs in without your password.`,
    '',
    'You can see and remove your passkeys under Settings, Your account.',
  ]);
  res.status(201).json({ passkey: publicPasskey(site, passkey), passkeys: await listFor(user.id) });
});

passkeysRouter.patch('/:id', manageLimit, requireAuth, async (req, res) => {
  const { name } = parse(z.object({ name: passkeyName }), req.body);
  const renamed = await prisma.passkey.updateMany({ where: { id: param(req, 'id'), userId: req.userId }, data: { name } });
  if (renamed.count !== 1) throw notFound('Passkey');
  res.json({ passkeys: await listFor(req.userId) });
});

/** Removing one never weakens the account, the password still being there, so it asks for nothing more. The last one may go too. */
passkeysRouter.delete('/:id', manageLimit, requireAuth, async (req, res) => {
  const passkey = await prisma.passkey.findFirst({ where: { id: param(req, 'id'), userId: req.userId }, include: { user: true } });
  if (!passkey) throw notFound('Passkey');
  await prisma.passkey.delete({ where: { id: passkey.id } });
  sendAccountNotice(passkey.user, 'A passkey was removed from your Wrkbench account', [
    `The passkey called "${passkey.name}" was just removed from your Wrkbench account. It can no longer sign in.`,
  ]);
  res.json({ passkeys: await listFor(req.userId) });
});

// ---- Signing in with one --------------------------------------------------------

/** Hands out a challenge. The answer is the same for everyone and says nothing about any account. */
passkeysRouter.post('/sign-in/start', loginLimit, async (_req, res) => {
  res.json({ options: await startSigningIn(siteOrRefuse()) });
});

/** A passkey stands for both steps, so this signs in at once, with no code asked, whether or not two-step sign-in is on. */
passkeysRouter.post('/sign-in/finish', loginLimit, async (req, res) => {
  const { response } = parse(z.object({ response: deviceAnswer }), req.body);
  const user = await finishSigningIn(siteOrRefuse(), response as unknown as AuthenticationResponseJSON);
  // One answer for every way it can fail, so it cannot be used to find out which passkeys exist.
  if (!user) throw new HttpError(401, NOT_ACCEPTED);
  res.json({ token: signToken(user), user: publicUser(user) });
});
