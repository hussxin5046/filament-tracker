import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { LegalNote } from '@/pages/LegalPages';
import { Button } from '@/components/ui/Button';
import { ErrorNote } from '@/components/ui/Display';
import { TextField } from '@/components/ui/Form';
import { NewPasswordField } from '@/components/ui/NewPasswordField';
import { useAuth } from '@/context/AuthContext';
import { REFUSALS, weakness } from '@/lib/passwordRules';
import styles from '@/pages/AuthPage.module.css';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register, continueAsGuest, completeTwoStep } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // Set once the password was right on an account with two-step sign-in: the form then asks for a code.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [usingRecovery, setUsingRecovery] = useState(false);

  // Where they were going when asked to sign in. Only a path inside the app is ever followed.
  const state = useLocation().state as { from?: unknown; notice?: unknown } | null;
  const notice = typeof state?.notice === 'string' ? state.notice : null;
  const from = typeof state?.from === 'string' && /^\/(?!\/)/.test(state.from) ? state.from : null;

  const registering = mode === 'register';
  // A guest may open the register page to keep their work under a real account.
  const upgrading = registering && Boolean(user?.isGuest);
  if (user && !upgrading) return <Navigate to={from ?? '/'} replace />;

  const run = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (challenge) void run(() => completeTwoStep(challenge, code));
    else if (registering) {
      // What the browser can already tell is said at once, in the server's words. The server still checks.
      const weak = weakness(password, { email, name });
      if (weak) setError(REFUSALS[weak]);
      else {
        void run(async () => {
          try {
            await register(name, email, password);
          } catch (cause) {
            setRefused(password);
            throw cause;
          }
        });
      }
    } else {
      void run(async () => {
        const next = await login(email, password);
        if (next) setChallenge(next);
      });
    }
  };

  const startOver = () => {
    setChallenge(null);
    setCode('');
    setUsingRecovery(false);
    setPassword('');
    setError('');
  };

  if (challenge) {
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
          <form className={styles.form} onSubmit={submit}>
            <h2 className={styles.heading}>Enter your code</h2>
            {usingRecovery ? (
              <TextField
                key="recovery"
                label="Recovery code"
                value={code}
                onChange={setCode}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                hint="One of the codes you saved when you turned on two-step sign-in. Each works once."
                autoFocus
                required
              />
            ) : (
              <TextField
                key="app"
                label="6-digit code"
                value={code}
                onChange={setCode}
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={7}
                hint="Open your authenticator app and enter the code it shows for Wrkbench."
                autoFocus
                required
              />
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" variant="primary" size="lg" block disabled={busy || code.trim().length < 6}>
              Sign in
            </Button>
            <Button
              variant="ghost"
              block
              disabled={busy}
              onClick={() => {
                setUsingRecovery(!usingRecovery);
                setCode('');
                setError('');
              }}
            >
              {usingRecovery ? 'Use a code from the app instead' : 'Lost your phone? Use a recovery code'}
            </Button>
          </form>
          <p className={styles.switch}>
            <button type="button" className={styles.linkButton} onClick={startOver}>
              Back to sign in
            </button>
          </p>
        </div>
      </main>
    );
  }

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

        <form className={styles.form} onSubmit={submit}>
          <h2 className={styles.heading}>{registering ? 'Create your account' : 'Sign in'}</h2>
          {notice && !registering && (
            <p className={styles.note} role="status">
              {notice}
            </p>
          )}
          {upgrading && <p className={styles.note}>Everything you set up as a guest stays with your new account.</p>}
          {registering && <TextField label="Your name" value={name} onChange={setName} autoComplete="name" required />}
          <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" inputMode="email" required />
          {registering ? (
            <NewPasswordField label="Password" value={password} onChange={setPassword} owner={{ email, name }} refused={refused} required />
          ) : (
            <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
          )}
          {!registering && (
            <p className={styles.forgot}>
              <Link to="/forgot-password">Forgot password?</Link>
            </p>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          {registering && <LegalNote action="creating an account" />}
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {registering ? 'Create account' : 'Sign in'}
          </Button>
          {!upgrading && (
            <>
              <div className={styles.divider}>or</div>
              <Button size="lg" block disabled={busy} onClick={() => void run(continueAsGuest)}>
                Continue as guest
              </Button>
              <p className={styles.note}>
                Try it with a sample workshop, no account needed. Guest sessions are removed after 7 days. Example
                brand names are not affiliated with Wrkbench.
              </p>
              <LegalNote action="continuing" />
            </>
          )}
        </form>

        <p className={styles.switch}>
          {upgrading ? (
            <Link to="/">Back to the workshop</Link>
          ) : registering ? (
            <>
              Already have an account? <Link to="/login" state={state}>Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/register" state={state}>Create an account</Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
