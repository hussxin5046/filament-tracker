import { browserSupportsWebAuthn, WebAuthnError } from '@simplewebauthn/browser';

/** A passkey as the server lists it for its owner. Nothing of the key itself. */
export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Kept in a synced account (iCloud, Google ...) and not on one device only. */
  synced: boolean;
  /** False for one made for another address: it cannot be used on this site. */
  worksHere: boolean;
}

/** Whether this browser, on this page, can make and use passkeys at all. They need https (or localhost). */
export const passkeysSupported = (): boolean => window.isSecureContext && browserSupportsWebAuthn();

/** A first name for a new passkey, from what the browser says it runs on. The member can change it. */
export function guessPasskeyName(userAgent: string = navigator.userAgent): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? 'Android phone' : 'Android tablet';
  if (/CrOS/.test(userAgent)) return 'Chromebook';
  if (/Windows/.test(userAgent)) return 'Windows PC';
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'Mac';
  if (/Linux/.test(userAgent)) return 'Linux computer';
  return 'Passkey';
}

/**
 * Whether the device's own prompt was closed, timed out, or refused by the person: nothing went wrong that
 * needs explaining. Browsers report all of these the same way.
 */
export function passkeyPromptDismissed(cause: unknown): boolean {
  if (cause instanceof WebAuthnError && cause.code === 'ERROR_CEREMONY_ABORTED') return true;
  return cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'AbortError');
}

/** What to tell someone when their device would not make a passkey. Null when they simply closed the prompt. */
export function addPasskeyProblem(cause: unknown): string | null {
  if (cause instanceof WebAuthnError && cause.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'This device already has a passkey for your account.';
  if (passkeyPromptDismissed(cause)) return null;
  if (cause instanceof WebAuthnError) return 'Your device could not make a passkey. It may need a screen lock, fingerprint or PIN set up first.';
  return cause instanceof Error ? cause.message : 'Something went wrong';
}
