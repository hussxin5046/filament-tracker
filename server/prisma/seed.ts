import bcrypt from 'bcryptjs';
import { prisma } from '@/db';
import { importSnapshot } from '@/services/snapshot';
import { getTemplate } from '@/templates';

/**
 * Creates a demo account with the example maker space.
 * Safe to run repeatedly: it never touches an account that already has a workspace.
 */
async function main() {
  const email = (process.env.SEED_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SEED_PASSWORD ?? '';
  const name = process.env.SEED_NAME ?? 'Demo Maker';
  // The same length a new account is asked for. The other rules are not applied to a development password.
  if (!email || [...password].length < 12) {
    throw new Error('Set SEED_EMAIL and SEED_PASSWORD (12 or more characters) in server/.env before seeding.');
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash: await bcrypt.hash(password, 10), emailVerifiedAt: new Date() },
  });

  const existing = await prisma.membership.count({ where: { userId: user.id } });
  if (existing > 0) {
    console.log(`${email} already has a workspace - nothing to seed.`);
    return;
  }

  const template = getTemplate('example');
  if (!template) throw new Error('Example template is missing');

  const summary = await prisma.$transaction(
    async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: template.snapshot.workspace?.name ?? template.name,
          description: template.snapshot.workspace?.description ?? '',
          currency: template.snapshot.workspace?.currency ?? 'GBP',
          targetMargin: template.snapshot.workspace?.targetMargin,
          members: { create: { userId: user.id, role: 'owner' } },
        },
      });
      return importSnapshot(tx, workspace.id, template.snapshot, user.id);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  console.log(`Seeded the example maker space for ${email}:`);
  console.table(summary);
  console.log('Sign in with the SEED_EMAIL / SEED_PASSWORD values from server/.env.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
