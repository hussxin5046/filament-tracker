/**
 * Where passkeys belong. A passkey is tied to a site address (the WebAuthn "relying party ID") and a browser
 * will only offer it there, so this is worked out from where Wrkbench is reached and from nothing else.
 *
 * This file reads no settings itself, so env.ts can use it to check them when the server starts.
 */
export interface PasskeySite {
  /** What passkeys are tied to: a host name, such as "wrkbench.example.com", or a parent of it. */
  id: string;
  /** The addresses a browser may be at when it makes or uses one, such as "https://wrkbench.example.com". */
  origins: string[];
}

interface AddressSettings {
  APP_URL?: string;
  CLIENT_ORIGIN: string;
  PASSKEY_SITE?: string;
}

function parsed(address: string | undefined): URL | null {
  if (!address) return null;
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

const isIpAddress = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
const within = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/**
 * The site passkeys are tied to, a sentence saying what is wrong with PASSKEY_SITE, or null when this copy of
 * Wrkbench is reached at an address passkeys cannot work at (a bare IP address, or one that cannot be read).
 *
 * Unless PASSKEY_SITE says otherwise, the site is the host name of APP_URL, or of CLIENT_ORIGIN without one.
 * Both addresses are accepted as the place a browser is at, as long as they are part of the site.
 */
export function passkeySiteFrom(settings: AddressSettings): PasskeySite | string | null {
  const addresses = [parsed(settings.APP_URL), parsed(settings.CLIENT_ORIGIN)].filter((url): url is URL => url !== null);
  const main = addresses[0];
  const chosen = settings.PASSKEY_SITE?.trim().toLowerCase();
  if (!main || isIpAddress(main.hostname)) return chosen ? 'PASSKEY_SITE needs APP_URL or CLIENT_ORIGIN to be an address with a name, such as https://wrkbench.example.com' : null;
  const id = chosen ?? main.hostname;
  if (chosen) {
    if (!/^[a-z0-9.-]+$/.test(chosen)) return 'PASSKEY_SITE must be a host name only, such as example.com: no https://, port or path';
    if (!within(main.hostname, chosen)) return `PASSKEY_SITE must be the host name people open Wrkbench at, or a parent of it (for www.example.com, that is example.com)`;
    if (chosen !== main.hostname && !chosen.includes('.')) return 'PASSKEY_SITE cannot be an ending such as "com" on its own';
  }
  const origins = [...new Set(addresses.filter((url) => within(url.hostname, id)).map((url) => url.origin))];
  return { id, origins };
}
