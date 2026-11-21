import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/db';
import { importSnapshot } from '@/services/snapshot';
import { removeUsers } from '@/services/accounts';
import { forgetOldAttempts } from '@/services/attempts';
import { forgetOldChallenges } from '@/services/passkeys';
import { getTemplate } from '@/templates';

/**
 * Guest sessions: a throwaway account with its own copy of the example workspace,
 * so someone can try the app without registering. Guests are removed after
 * GUEST_DAYS unless they turn the session into a real account first.
 */
export const GUEST_DAYS = 7;

/** Reserved top-level domain: never a real mailbox, and registration refuses it. */
const GUEST_DOMAIN = '@guest.invalid';
export const isGuestEmail = (email: string) => email.endsWith(GUEST_DOMAIN);

export async function createGuest() {
  const template = getTemplate('example');
  if (!template) throw new Error('Example template is missing');
  // Nobody ever knows this password: a guest gets in with the token alone.
  const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 10);
  const email = `guest-${randomBytes(9).toString('hex')}${GUEST_DOMAIN}`;

  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.create({ data: { email, name: 'Guest', passwordHash, isGuest: true } });
      const workspace = await tx.workspace.create({
        data: {
          name: template.snapshot.workspace?.name ?? template.name,
          description: template.snapshot.workspace?.description ?? '',
          currency: template.snapshot.workspace?.currency ?? 'GBP',
          targetMargin: template.snapshot.workspace?.targetMargin,
          members: { create: { userId: user.id, role: 'owner' } },
        },
      });
      await importSnapshot(tx, workspace.id, template.snapshot, user.id);
      return user;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** Delete expired guests, along with every workspace that has no registered member left. */
export async function removeExpiredGuests(): Promise<number> {
  const cutoff = new Date(Date.now() - GUEST_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.user.findMany({ where: { isGuest: true, createdAt: { lt: cutoff } }, select: { id: true } });
  if (expired.length === 0) return 0;
  await removeUsers(expired.map((user) => user.id));
  return expired.length;
}

export function scheduleGuestCleanup(): void {
  const run = () => {
    removeExpiredGuests()
      .then((count) => {
        if (count > 0) console.log(`Removed ${count} expired guest session${count === 1 ? '' : 's'}`);
      })
      .catch((cause: unknown) => console.error('Guest cleanup failed', cause));
    // The same round sweeps out sign-in attempts too old to count.
    forgetOldAttempts().catch((cause: unknown) => console.error('Could not remove old sign-in attempts', cause));
    forgetOldChallenges().catch((cause: unknown) => console.error('Could not remove old passkey challenges', cause));
  };
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
