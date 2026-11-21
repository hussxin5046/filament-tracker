import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { Fingerprint, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNote, Muted, SectionTitle } from '@/components/ui/Display';
import { TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { daysSince, formatDate, relativeDays } from '@/lib/format';
import { addPasskeyProblem, guessPasskeyName, passkeysSupported, type Passkey } from '@/lib/passkeys';
import styles from '@/components/settings/Passkeys.module.css';

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Something went wrong');

interface Listing {
  /** False where this copy of Wrkbench is reached at an address passkeys cannot work at. */
  available: boolean;
  max: number;
  passkeys: Passkey[];
}

type Dialog = { kind: 'prove' } | { kind: 'name'; passkey: Passkey; fresh: boolean } | { kind: 'remove'; passkey: Passkey };

function details(passkey: Passkey): string {
  const used = passkey.lastUsedAt ? `Last used ${relativeDays(-daysSince(passkey.lastUsedAt))}` : 'Never used';
  return `Added ${formatDate(passkey.createdAt)} · ${used}`;
}

/** The member's passkeys: adding one (after proving who they are), naming and removing them. Part of the account settings. */
export function PasskeysSection() {
  const { user } = useAuth();
  const toast = useToast();
  const [listing, setListing] = useState<Listing | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const registered = Boolean(user && !user.isGuest);

  useEffect(() => {
    if (!registered) return;
    let current = true;
    api
      .get<Listing>('/auth/passkeys')
      .then((answer) => {
        if (current) setListing(answer);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [registered]);

  if (!user || user.isGuest) return null;

  const passkeys = listing?.passkeys ?? [];
  const twoStep = Boolean(user.twoStep);
  const close = () => setDialog(null);
  const open = (next: Dialog) => {
    setPassword('');
    setCode('');
    setError('');
    setName(next.kind === 'name' ? next.passkey.name : '');
    setDialog(next);
  };
  const attempt = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const keep = (answer: { passkeys: Passkey[] }) => setListing((before) => (before ? { ...before, passkeys: answer.passkeys } : before));

  const add = () =>
    attempt(async () => {
      const { options } = await api.post<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/auth/passkeys/add/start', {
        password,
        ...(twoStep ? { code } : {}),
      });
      let response;
      try {
        response = await startRegistration({ optionsJSON: options });
      } catch (cause) {
        const problem = addPasskeyProblem(cause);
        // They closed the device's prompt: nothing was added and there is nothing to explain.
        if (problem === null) close();
        else setError(problem);
        return;
      }
      const answer = await api.post<{ passkey: Passkey; passkeys: Passkey[] }>('/auth/passkeys/add/finish', { response, name: guessPasskeyName() });
      keep(answer);
      open({ kind: 'name', passkey: answer.passkey, fresh: true });
    });
  const rename = (passkey: Passkey, fresh: boolean) =>
    attempt(async () => {
      if (name.trim() !== passkey.name) keep(await api.patch<{ passkeys: Passkey[] }>(`/auth/passkeys/${passkey.id}`, { name }));
      close();
      toast(fresh ? 'Passkey added' : 'Passkey renamed');
    });
  const remove = (passkey: Passkey) =>
    attempt(async () => {
      await api.delete(`/auth/passkeys/${passkey.id}`);
      setListing((before) => (before ? { ...before, passkeys: before.passkeys.filter((other) => other.id !== passkey.id) } : before));
      close();
      toast('Passkey removed');
    });

  const cancel = (
    <Button onClick={close} disabled={busy}>
      Cancel
    </Button>
  );
  /** Why a passkey cannot be added from here, or null when one can. */
  const blocked = !passkeysSupported()
    ? 'This browser cannot use passkeys.'
    : listing && !listing.available
      ? 'Passkeys cannot be used at this address.'
      : user.emailVerified === false
        ? 'Confirm your email address first, with the link Wrkbench emailed you.'
        : listing && passkeys.length >= listing.max
          ? `You have ${listing.max} passkeys, which is the most an account can have. Remove one to add another.`
          : null;

  return (
    <>
      <SectionTitle>Passkeys</SectionTitle>
      <Muted>
        Sign in with your fingerprint, face or screen lock instead of typing your password. Your password still works if you lose the device.
      </Muted>
      {passkeys.length > 0 && (
        <ul className={styles.list}>
          {passkeys.map((passkey) => (
            <li key={passkey.id} className={styles.passkey}>
              <Fingerprint size={20} aria-hidden className={styles.icon} />
              <span className={styles.text}>
                <span className={styles.name}>{passkey.name}</span>
                <span className={`${styles.details} ${passkey.worksHere ? '' : styles.elsewhere}`}>
                  {passkey.worksHere ? details(passkey) : 'Made for another address. It will not work here.'}
                </span>
              </span>
              <span className={styles.rowActions}>
                <Button size="sm" icon={Pencil} aria-label={`Rename ${passkey.name}`} onClick={() => open({ kind: 'name', passkey, fresh: false })}>
                  Rename
                </Button>
                <Button size="sm" icon={Trash2} aria-label={`Remove ${passkey.name}`} onClick={() => open({ kind: 'remove', passkey })}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {blocked ? (
        <Muted>{blocked}</Muted>
      ) : (
        <div className={styles.actions}>
          <Button icon={Fingerprint} onClick={() => open({ kind: 'prove' })}>
            Add a passkey
          </Button>
        </div>
      )}

      {dialog?.kind === 'prove' && (
        <Modal
          title="Add a passkey"
          onClose={close}
          onSubmit={() => void add()}
          footer={
            <>
              {cancel}
              <Button type="submit" variant="primary" disabled={busy || !password || (twoStep && code.trim().length < 6)}>
                Continue
              </Button>
            </>
          }
        >
          <p>First, confirm it is you. Your device will then ask for your fingerprint, face or screen lock.</p>
          <TextField label="Your password" type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus required />
          {twoStep && (
            <TextField
              label="Code"
              value={code}
              onChange={setCode}
              autoComplete="one-time-code"
              hint="The 6-digit code from your authenticator app, or a recovery code. A passkey signs in without one from then on."
              required
            />
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
        </Modal>
      )}

      {dialog?.kind === 'name' && (
        <Modal
          title={dialog.fresh ? 'Name this passkey' : 'Rename passkey'}
          onClose={close}
          onSubmit={() => void rename(dialog.passkey, dialog.fresh)}
          footer={
            <>
              {!dialog.fresh && cancel}
              <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
                {dialog.fresh ? 'Done' : 'Rename'}
              </Button>
            </>
          }
        >
          {dialog.fresh && <p>Your passkey is added. Give it a name you will recognise, such as the device it is on.</p>}
          <TextField label="Name" value={name} onChange={setName} maxLength={60} autoFocus required />
          {error && <ErrorNote>{error}</ErrorNote>}
        </Modal>
      )}

      {dialog?.kind === 'remove' && (
        <Modal
          title="Remove this passkey?"
          onClose={close}
          onSubmit={() => void remove(dialog.passkey)}
          footer={
            <>
              {cancel}
              <Button type="submit" variant="danger" disabled={busy}>
                Remove
              </Button>
            </>
          }
        >
          <p>
            You will not be able to sign in with <strong>{dialog.passkey.name}</strong> again. Your password still works. The passkey may stay listed on
            your device until you delete it there too.
          </p>
          {error && <ErrorNote>{error}</ErrorNote>}
        </Modal>
      )}
    </>
  );
}
