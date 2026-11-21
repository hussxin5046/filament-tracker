/**
 * Remove every passkey from one account, for whoever runs the server, when its owner asks for it: a lost or
 * stolen device they cannot remove themselves, for example.
 *
 *   npm run account:passkeys-off -- someone@example.com
 *
 * Make sure the person asking is who they say they are first. Every device signed in to the account is signed
 * out, and the account is emailed. The password, and two-step sign-in if it is on, are left as they are.
 */
import { prisma } from '@/db';
import { sendMail } from '@/services/mail';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Use: npm run account:passkeys-off -- <email>');
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account uses ${email}.`);
    process.exitCode = 1;
  } else if ((await prisma.passkey.count({ where: { userId: user.id } })) === 0) {
    console.log(`${email} has no passkeys. Nothing was changed.`);
  } else {
    const [removed] = await prisma.$transaction([
      prisma.passkey.deleteMany({ where: { userId: user.id } }),
      prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } }),
    ]);
    sendMail({
      to: user.email,
      subject: 'Your passkeys were removed from your Wrkbench account',
      text: [`Hello ${user.name},`, '', 'Whoever runs this copy of Wrkbench removed every passkey from your account, and every device was signed out.', '', 'Sign in with your password, then add a passkey again under Settings, Your account.'].join('\n'),
    });
    console.log(`Removed ${removed.count} passkey${removed.count === 1 ? '' : 's'} from ${email}, and every device was signed out.`);
    // Give the email a moment to leave before the process ends.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
} finally {
  await prisma.$disconnect();
}
