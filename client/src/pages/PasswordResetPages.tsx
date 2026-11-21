import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ErrorNote } from '@/components/ui/Display';
import { TextField } from '@/components/ui/Form';
import { NewPasswordField } from '@/components/ui/NewPasswordField';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api';
import { REFUSALS, weakness } from '@/lib/passwordRules';
import { LegalLinks } from '@/pages/LegalPages';
import styles from '@/pages/AuthPage.module.css';

/** The panel every signed-out page of this kind sits in. */
export function Frame({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <img src="/icon.svg" alt="" width={44} height={44} />
          <div>
            <h1 className={styles.title}>Wrkbench</h1>
            <p className={styles.tagline}>Know what is in stock, where it is, and what needs attention.</p>
          </div>
        </div>
        {children}
        <p className={styles.switch}>{footer}</p>
        <LegalLinks />
      </div>
    </main>
  );
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Something went wrong');

/** Step one: ask for the link. The answer never says whether the address has an account. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      setSent((await api.post<{ message: string }>('/auth/forgot', { email })).message);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame footer={<Link to="/login">Back to sign in</Link>}>
      <form className={styles.form} onSubmit={submit}>
        <h2 className={styles.heading}>Forgot your password?</h2>
        {sent ? (
          <p className={styles.note} role="status">
            {sent} The link works for one hour. Check your spam folder if it does not arrive.
          </p>
        ) : (
          <>
            <p className={styles.note}>Enter the email you signed up with and we will send you a link to choose a new password.</p>
            <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" required />
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              Send reset link
            </Button>
          </>
        )}
      </form>
    </Frame>
  );
}

/** Step two: the emailed link lands here with its token in the URL fragment. */
export function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  // Read once: the fragment never reaches the server, and it is cleared from the address bar straight away.
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    if (value) window.history.replaceState(null, '', window.location.pathname);
    return value;
  });
  const [password, setPassword] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A link works once, for an hour. Ask the server before showing the form, so a used link says so at once.
  const [dead, setDead] = useState('');
  const [checking, setChecking] = useState(Boolean(token));

  useEffect(() => {
    if (!token) return;
    let current = true;
    api
      .post('/auth/reset-check', { token })
      .catch((cause: unknown) => {
        // Only a definite "no" hides the form. If the server cannot be reached, submitting will report it.
        if (current && cause instanceof ApiError && cause.status === 400) setDead(cause.message);
      })
      .finally(() => {
        if (current) setChecking(false);
      });
    return () => {
      current = false;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // What the browser can already tell is said at once, in the server's words. The server still checks.
    const weak = weakness(password);
    if (weak) {
      setError(REFUSALS[weak]);
      return;
    }
    setError('');
    setBusy(true);
    try {
      if (await resetPassword(token, password)) navigate('/', { replace: true });
      // With two-step sign-in the new password is only half of signing in.
      else navigate('/login', { replace: true, state: { notice: 'Your password is changed. Sign in with it, then enter a code from your authenticator app.' } });
    } catch (cause) {
      setRefused(password);
      setError(message(cause));
      setBusy(false);
    }
  };

  return (
    <Frame footer={<Link to="/forgot-password">Ask for a new link</Link>}>
      <form className={styles.form} onSubmit={submit}>
        <h2 className={styles.heading}>Choose a new password</h2>
        {checking ? (
          <p className={styles.note} role="status">
            Checking your link…
          </p>
        ) : dead ? (
          <ErrorNote>{dead}</ErrorNote>
        ) : token ? (
          <>
            <NewPasswordField
              label="New password"
              value={password}
              onChange={setPassword}
              refused={refused}
              hintAfter="Every device signed in to your account will be signed out."
              required
            />
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              Set password and sign in
            </Button>
          </>
        ) : (
          <ErrorNote>This link is incomplete. Open the link from your email again, or ask for a new one.</ErrorNote>
        )}
      </form>
    </Frame>
  );
}
