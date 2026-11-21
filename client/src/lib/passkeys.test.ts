import { describe, expect, it } from 'vitest';
import { guessPasskeyName, passkeyPromptDismissed } from '@/lib/passkeys';

describe('passkeys in the browser', () => {
  it('guesses a name for a new passkey from the device', () => {
    expect(guessPasskeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe('iPhone');
    expect(guessPasskeyName('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('iPad');
    expect(guessPasskeyName('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toBe('Android phone');
    expect(guessPasskeyName('Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Android tablet');
    expect(guessPasskeyName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Windows PC');
    expect(guessPasskeyName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe('Mac');
    expect(guessPasskeyName('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Chromebook');
    expect(guessPasskeyName('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Linux computer');
    expect(guessPasskeyName('something else')).toBe('Passkey');
  });

  it('knows a closed prompt from a real problem', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name });
    expect(passkeyPromptDismissed(named('NotAllowedError'))).toBe(true);
    expect(passkeyPromptDismissed(named('AbortError'))).toBe(true);
    expect(passkeyPromptDismissed(named('SecurityError'))).toBe(false);
    expect(passkeyPromptDismissed(new Error('The passkey could not be added.'))).toBe(false);
  });
});
