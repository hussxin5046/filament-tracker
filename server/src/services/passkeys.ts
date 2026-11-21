import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { prisma } from '@/db';
import { env } from '@/env';
import { passkeySiteFrom, type PasskeySite } from '@/services/passkeySite';

/**
 * Passkeys: signing in with a key pair the member's device holds, unlocked by their fingerprint, face or PIN.
 *
 * All the cryptography is @simplewebauthn/server's. What is here is the book-keeping around it: which site
 * passkeys belong to, the one-time challenges, and the stored credentials with their sign-in counters.
 *
 * A passkey signs in on its own and stands for both steps of two-step sign-in. That is only sound because the
 * device must check its owner every time ("user verification" is required when one is made and when one is
 * used): the device is something they have, and the fingerprint or PIN is the second thing.
 */
export const MAX_PASSKEYS = 10;
const CHALLENGE_MS = 5 * 60 * 1000;
// What devices are asked to sign with, most preferred first: EdDSA, ES256, RS256. Named here so that making a
// passkey and checking it can never disagree, whatever a later version of the library prefers.
const ALGORITHMS = [-8, -7, -257];

type Purpose = 'add' | 'sign-in';

/** The site passkeys are tied to here, or null where they cannot work (see passkeySiteFrom). env.ts has already refused a wrong PASSKEY_SITE. */
export function passkeySite(): PasskeySite | null {
  const site = passkeySiteFrom(env);
  return site && typeof site !== 'string' ? site : null;
}

async function rememberChallenge(challenge: string, purpose: Purpose, userId: string | null): Promise<void> {
  // Expired ones are cleared as new ones are made, so the table stays as small as the last five minutes.
  await prisma.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.passkeyChallenge.create({ data: { challenge, purpose, userId, expiresAt: new Date(Date.now() + CHALLENGE_MS) } });
}

/** Challenges nobody answered. They are cleared whenever a new one is made; this is for a server where none is. */
export async function forgetOldChallenges(): Promise<number> {
  return (await prisma.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
}

/** True once, for a challenge that was handed out for this purpose (and this account) and has not run out. */
async function useChallenge(challenge: string, purpose: Purpose, userId: string | null): Promise<boolean> {
  const used = await prisma.passkeyChallenge.deleteMany({ where: { challenge, purpose, userId, expiresAt: { gt: new Date() } } });
  return used.count === 1;
}

interface Owner {
  id: string;
  email: string;
  name: string;
}

/** What the browser needs to ask the device for a new passkey for this account. */
export async function startAdding(site: PasskeySite, user: Owner) {
  const existing = await prisma.passkey.findMany({ where: { userId: user.id, site: site.id }, select: { credentialId: true, transports: true } });
  const options = await generateRegistrationOptions({
    rpName: 'Wrkbench',
    rpID: site.id,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    // A device that already holds one for this account says so instead of making a second.
    excludeCredentials: existing.map((passkey) => ({ id: passkey.credentialId, transports: passkey.transports?.split(',') })),
    // "Resident" so the device can offer it on the sign-in page without an email being typed first.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    supportedAlgorithmIDs: ALGORITHMS,
  });
  await rememberChallenge(options.challenge, 'add', user.id);
  return options;
}

/** Check the device's answer and keep the new passkey. Null when the answer does not hold up. */
export async function finishAdding(site: PasskeySite, userId: string, response: RegistrationResponseJSON, name: string) {
  let info;
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: (challenge) => useChallenge(challenge, 'add', userId),
      expectedOrigin: site.origins,
      expectedRPID: site.id,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    });
    if (!result.verified) return null;
    info = result.registrationInfo;
  } catch {
    return null;
  }
  return prisma.passkey.create({
    data: {
      userId,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey),
      counter: info.credential.counter,
      name,
      site: site.id,
      transports: info.credential.transports?.join(',') || null,
      synced: info.credentialDeviceType === 'multiDevice',
    },
  });
}

/** What the browser needs to ask the device for any passkey it holds for this site. Nobody is named. */
export async function startSigningIn(site: PasskeySite) {
  const options = await generateAuthenticationOptions({ rpID: site.id, userVerification: 'required' });
  await rememberChallenge(options.challenge, 'sign-in', null);
  return options;
}

const toBase64Url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

/**
 * The account a passkey's answer signs in, or null when anything about it does not hold up: an unknown passkey,
 * one made for another site, a used or expired challenge, a wrong signature, the device not having checked its
 * owner, or a counter that has not moved on.
 */
export async function finishSigningIn(site: PasskeySite, response: AuthenticationResponseJSON) {
  const passkey = await prisma.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } });
  if (!passkey || passkey.site !== site.id || passkey.user.isGuest) return null;
  // The device also says whose passkey it is. It has to agree with our record.
  const handle = response.response.userHandle;
  if (handle && handle !== toBase64Url(passkey.userId)) return null;

  const before = Number(passkey.counter);
  let after: number;
  let synced: boolean;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => useChallenge(challenge, 'sign-in', null),
      expectedOrigin: site.origins,
      expectedRPID: site.id,
      // The library refuses a counter that is not higher than this one, unless both are 0.
      credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: before, transports: passkey.transports?.split(',') },
      requireUserVerification: true,
    });
    if (!result.verified) return null;
    after = result.authenticationInfo.newCounter;
    synced = result.authenticationInfo.credentialDeviceType === 'multiDevice';
  } catch {
    return null;
  }
  // The same rule again, in the one statement that records the new count: of two sign-ins made at the same
  // moment with one counter value, only the first is let through.
  const moved = await prisma.passkey.updateMany({
    where: { id: passkey.id, ...(after > 0 ? { counter: { lt: after } } : { counter: 0 }) },
    data: { counter: after, lastUsedAt: new Date(), synced },
  });
  return moved.count === 1 ? passkey.user : null;
}

/** As the member sees one in Settings. Nothing about the key itself. */
export function publicPasskey(site: PasskeySite | null, passkey: { id: string; name: string; site: string; synced: boolean; createdAt: Date; lastUsedAt: Date | null }) {
  return {
    id: passkey.id,
    name: passkey.name,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt,
    synced: passkey.synced,
    /** False for one made for another address, such as after the site moved: it cannot be used here. */
    worksHere: passkey.site === site?.id,
  };
}
