import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * What a NEW password has to pass: when registering, changing the password, and choosing one from a reset link.
 * Signing in never comes through here, so a password set under older, looser rules keeps working.
 *
 * Length is what is asked for: no symbols, capitals or digits are required. On top of length, a password is
 * refused when it is one everybody uses, one short pattern repeated, made from the account's own name or
 * address, or known from a data leak.
 *
 * The web app shows the same rules as the user types: keep client/src/lib/passwordRules.ts in step.
 * Whether a password is known from a data leak is asked in services/passwords.ts. This file reads no settings,
 * so the script that builds the list can use it without any.
 */
export const PASSWORD_MIN_CHARACTERS = 12;
// bcrypt only reads the first 72 bytes, so anything after them would be ignored without a word.
// Counted in bytes: accented letters take two and most emoji four.
export const PASSWORD_MAX_BYTES = 72;

export const REFUSALS = {
  short: `Use at least ${PASSWORD_MIN_CHARACTERS} characters`,
  long: `Use at most ${PASSWORD_MAX_BYTES} characters (fewer with accents or emoji)`,
  common: 'This is a commonly used password, so it is easy to guess. Choose something else.',
  repeated: 'This repeats the same few characters, so it is easy to guess. Choose something else.',
  personal: 'Do not make your password from your name, your email address or the word Wrkbench.',
  leaked: 'This password has appeared in a data leak, so other people may try it. Choose a different one.',
} as const;

export type Weakness = Exclude<keyof typeof REFUSALS, 'leaked'>;

/** Whose password it is, for refusing one made from their own details. */
export interface Owner {
  email?: string;
  name?: string;
}

/** Common passwords of 12 characters or more, in lower case, one per line. Built by scripts/import-common-passwords.ts. */
export const COMMON_PASSWORDS_FILE = fileURLToPath(new URL('../../data/passwords/common.txt', import.meta.url));

let common: Set<string> | null = null;

function commonPasswords(): Set<string> {
  common ??= new Set(readFileSync(COMMON_PASSWORDS_FILE, 'utf8').split('\n').filter(Boolean));
  return common;
}

/** Counted the way a person counts: an emoji or an accented letter is one character. */
export const characterCount = (text: string): number => [...text].length;

const REPEAT_UNIT_MAX = 4;

/** "aaaaaaaaaaaa", "abababababab", "abcdabcdabcd": one group of up to four characters, over and over. */
function isRepeated(password: string): boolean {
  const characters = [...password];
  for (let unit = 1; unit <= REPEAT_UNIT_MAX; unit += 1) {
    if (characters.every((character, index) => character === characters[index % unit])) return true;
  }
  return false;
}

const lettersOf = (text: string): string => text.toLowerCase().replace(/[^\p{L}]/gu, '');

/** The account's email address, or nothing but its name, the first part of its address or "wrkbench", with digits and symbols around. */
function isPersonal(password: string, owner: Owner): boolean {
  const email = owner.email?.trim().toLowerCase() ?? '';
  if (email && password.toLowerCase() === email) return true;
  const letters = lettersOf(password);
  // Very short names are left out: "Al" would otherwise rule out too much for no gain.
  const words = ['wrkbench', lettersOf(owner.name ?? ''), lettersOf(email.split('@')[0])].filter((word) => word.length >= 3);
  return words.includes(letters);
}

/** The first rule a new password breaks that can be told without asking anyone, or null when it passes them all. */
export function weakness(password: string, owner: Owner = {}): Weakness | null {
  if (characterCount(password) < PASSWORD_MIN_CHARACTERS) return 'short';
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return 'long';
  // Before the list, which holds some of these too: the web app may not have loaded its copy yet, and should give the same reason.
  if (isRepeated(password)) return 'repeated';
  if (commonPasswords().has(password.toLowerCase())) return 'common';
  if (isPersonal(password, owner)) return 'personal';
  return null;
}
