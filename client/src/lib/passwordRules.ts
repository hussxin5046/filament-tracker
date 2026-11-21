/**
 * The rules for a new password, as far as they can be told while it is being typed. The server decides
 * (server/src/services/passwordRules.ts, which this mirrors) and also asks whether the password is known from
 * a data leak; this only saves the user from finding out after pressing the button.
 */
export const PASSWORD_MIN_CHARACTERS = 12;
export const PASSWORD_MAX_BYTES = 72;

/** Shown under a new-password field before anything is typed. */
export const PASSWORD_HINT = `At least ${PASSWORD_MIN_CHARACTERS} characters. A few unrelated words work well. No symbols or capitals needed.`;

/** What the server answers for each rule, word for word, for a refusal the browser can already give. */
export const REFUSALS = {
  short: `Use at least ${PASSWORD_MIN_CHARACTERS} characters`,
  long: `Use at most ${PASSWORD_MAX_BYTES} characters (fewer with accents or emoji)`,
  common: 'This is a commonly used password, so it is easy to guess. Choose something else.',
  repeated: 'This repeats the same few characters, so it is easy to guess. Choose something else.',
  personal: 'Do not make your password from your name, your email address or the word Wrkbench.',
} as const;

export type Weakness = keyof typeof REFUSALS;

/** Whose password it is, for refusing one made from their own details. */
export interface Owner {
  email?: string;
  name?: string;
}

/** Counted the way a person counts: an emoji or an accented letter is one character. */
const characterCount = (text: string): number => [...text].length;
const byteCount = (text: string): number => new TextEncoder().encode(text).length;

const REPEAT_UNIT_MAX = 4;

function isRepeated(password: string): boolean {
  const characters = [...password];
  for (let unit = 1; unit <= REPEAT_UNIT_MAX; unit += 1) {
    if (characters.every((character, index) => character === characters[index % unit])) return true;
  }
  return false;
}

const lettersOf = (text: string): string => text.toLowerCase().replace(/[^\p{L}]/gu, '');

function isPersonal(password: string, owner: Owner): boolean {
  const email = owner.email?.trim().toLowerCase() ?? '';
  if (email && password.toLowerCase() === email) return true;
  const letters = lettersOf(password);
  const words = ['wrkbench', lettersOf(owner.name ?? ''), lettersOf(email.split('@')[0])].filter((word) => word.length >= 3);
  return words.includes(letters);
}

/**
 * The first rule a new password breaks, or null when it passes all that can be checked here.
 * `common` is the list of common passwords once it has loaded; until then that rule is left to the server.
 */
export function weakness(password: string, owner: Owner = {}, common: ReadonlySet<string> | null = null): Weakness | null {
  if (characterCount(password) < PASSWORD_MIN_CHARACTERS) return 'short';
  if (byteCount(password) > PASSWORD_MAX_BYTES) return 'long';
  if (isRepeated(password)) return 'repeated';
  if (common?.has(password.toLowerCase())) return 'common';
  if (isPersonal(password, owner)) return 'personal';
  return null;
}

export interface PasswordNote {
  /** "quiet" is still being typed, "bad" will be refused, "good" passes what can be checked here. */
  tone: 'quiet' | 'bad' | 'good';
  text: string;
}

/** The line under a new-password field as it is typed. Null before anything is typed: the hint shows then. */
export function passwordNote(password: string, owner: Owner = {}, common: ReadonlySet<string> | null = null): PasswordNote | null {
  if (!password) return null;
  const weak = weakness(password, owner, common);
  if (weak === null) return { tone: 'good', text: 'Long enough.' };
  if (weak === 'short') {
    const missing = PASSWORD_MIN_CHARACTERS - characterCount(password);
    return { tone: 'quiet', text: `${missing} more character${missing === 1 ? '' : 's'} needed.` };
  }
  if (weak === 'long') return { tone: 'bad', text: `Too long. ${REFUSALS.long}.` };
  return { tone: 'bad', text: REFUSALS[weak] };
}

let loading: Promise<ReadonlySet<string>> | null = null;

/** The list of common passwords, fetched the first time a new-password field is shown and kept from then on. */
export function loadCommonPasswords(): Promise<ReadonlySet<string>> {
  loading ??= import('@/lib/commonPasswords').then(({ COMMON_PASSWORDS }) => new Set(COMMON_PASSWORDS.split('\n')));
  // A failed download (offline, say) is tried again the next time a field appears.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
