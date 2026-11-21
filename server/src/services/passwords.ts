import { createHash } from 'node:crypto';
import { env } from '@/env';
import { HttpError } from '@/http';
import { REFUSALS, weakness, type Owner } from '@/services/passwordRules';

const LOOKUP_TIMEOUT_MS = 3000;
// After a failed lookup, the next ones are skipped for this long, so a server that cannot reach the service
// does not make everyone who sets a password wait for the timeout.
const LOOKUP_PAUSE_MS = 5 * 60 * 1000;
let lookupPausedUntil = 0;

/**
 * Whether a password is in Have I Been Pwned's collection of leaked passwords.
 *
 * Neither the password nor its full hash leaves the server. The service is asked for every leaked hash that
 * starts with the same five characters (of forty) and the comparison is made here. Padding is asked for, so
 * the size of the answer says nothing either. SHA-1 is what the service indexes by, which is the only
 * reason it is used: the result is never stored, and what is stored is still made by bcrypt.
 *
 * If the service cannot be reached, the answer is "no": the built-in list of common passwords has already
 * been applied, and nobody should be kept from setting a password by somebody else's outage.
 * PASSWORD_BREACH_CHECK=off never asks at all.
 */
export async function foundInLeak(password: string): Promise<boolean> {
  if (env.PASSWORD_BREACH_CHECK === 'off' || Date.now() < lookupPausedUntil) return false;
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = digest.slice(0, 5);
  const rest = digest.slice(5);
  let problem: string;
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'Wrkbench' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (response.ok) {
      for (const line of (await response.text()).split('\n')) {
        const [suffix, count] = line.trim().split(':');
        // Padding rows carry a count of 0: they are there to be ignored.
        if (suffix === rest) return Number(count) > 0;
      }
      return false;
    }
    problem = `it answered ${response.status}`;
  } catch (error) {
    problem = error instanceof Error && error.name === 'TimeoutError' ? 'it took too long to answer' : 'it could not be reached';
  }
  lookupPausedUntil = Date.now() + LOOKUP_PAUSE_MS;
  console.warn(`[passwords] The leaked-password lookup was skipped: ${problem}. New passwords are checked against the built-in list only for the next 5 minutes.`);
  return false;
}

/** For tests: forget an earlier failed lookup. */
export function resumeLeakLookups(): void {
  lookupPausedUntil = 0;
}

/**
 * The last word on a new password, once the request is known to be genuine (the address is free, the current
 * password was right, the reset link is good), so that junk requests never cause a call to the outside.
 * A refusal is always a 400: from Settings, a 401 would sign the member out.
 */
export async function requireGoodPassword(password: string, owner: Owner): Promise<void> {
  const weak = weakness(password, owner);
  if (weak) throw new HttpError(400, REFUSALS[weak]);
  if (await foundInLeak(password)) throw new HttpError(400, REFUSALS.leaked);
}
