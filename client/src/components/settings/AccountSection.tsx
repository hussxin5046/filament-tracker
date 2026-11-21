import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Trash2 } from 'lucide-react';
import { PasskeysSection } from '@/components/settings/PasskeysSection';
import { TwoStepSection } from '@/components/settings/TwoStepSection';
import { Button } from '@/components/ui/Button';
import { Muted, SectionTitle } from '@/components/ui/Display';
import { Checkbox, FormGrid, TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { NewPasswordField } from '@/components/ui/NewPasswordField';
import { useAction, useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { weakness } from '@/lib/passwordRules';
import { SerialSaver } from '@/lib/serialSave';
import type { User } from '@/lib/types';
import styles from '@/components/settings/Settings.module.css';

/** Whether the daily report opens by itself. Shows at once, then saves; a failed save puts the old choice back. */
function DailyReportPreference() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  // One save at a time, so quick clicks reach the server in order and the last one is what is stored.
  const saver = useRef(new SerialSaver((dailyReportAuto: boolean) => api.patch<{ user: User }>('/auth/me/preferences', { dailyReportAuto })));
  /** The account as it was before a burst of clicks, to put back if saving fails. */
  const before = useRef<User | null>(null);
  if (!user) return null;

  const change = (dailyReportAuto: boolean) => {
    if (!saver.current.busy) before.current = user;
    updateUser({ ...user, dailyReportAuto });
    saver.current.save(dailyReportAuto, {
      onSaved: ({ user: saved }) => updateUser(saved),
      onFailed: (error, lastSaved) => {
        const restore = lastSaved?.user ?? before.current;
        if (restore) updateUser(restore);
        toast(error instanceof Error ? error.message : 'Could not save your choice', 'danger');
      },
    });
  };

  return (
    <>
      <SectionTitle>Daily report</SectionTitle>
      <Checkbox
        label="Open the daily report on my first visit each day"
        hint="When this is off, the Daily report button in the navigation still opens it. Only you are affected."
        checked={user.dailyReportAuto !== false}
        onChange={change}
      />
    </>
  );
}

/** About the signed-in person, not the workspace: password, other devices, and deleting the account. */
export function AccountSection() {
  const { user, changePassword, signOutOthers, deleteAccount } = useAuth();
  const { run, busy } = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  if (!user) return null;

  if (user.isGuest) {
    return (
      <>
        <SectionTitle>Your account</SectionTitle>
        <Muted>
          You are using a guest session, which is removed after 7 days. <Link to="/register">Create an account</Link> to keep what you
          have set up.
        </Muted>
        <DailyReportPreference />
      </>
    );
  }

  const savePassword = async () => {
    if (await run(() => changePassword(current, next), 'Password changed. Other devices were signed out.')) {
      setCurrent('');
      setNext('');
    } else {
      setRefused(next);
    }
  };

  return (
    <>
      <SectionTitle>Your account</SectionTitle>
      <Muted>
        Signed in as {user.name} ({user.email}).
      </Muted>

      <DailyReportPreference />

      <SectionTitle>Change password</SectionTitle>
      <form
        className={styles.general}
        onSubmit={(event) => {
          event.preventDefault();
          void savePassword();
        }}
      >
        <FormGrid>
          <TextField label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" required />
          <NewPasswordField label="New password" value={next} onChange={setNext} owner={user} refused={refused} required />
        </FormGrid>
        <div>
          <Button type="submit" variant="primary" disabled={busy || !current || weakness(next, user) !== null}>
            Change password
          </Button>
        </div>
      </form>

      <PasskeysSection />

      <TwoStepSection />

      <SectionTitle>Other devices</SectionTitle>
      <Muted>If you signed in somewhere you no longer use or trust, sign those devices out. This one stays signed in.</Muted>
      <div className={styles.danger}>
        <Button icon={LogOut} disabled={busy} onClick={() => void run(signOutOthers, 'Other devices were signed out')}>
          Sign out other devices
        </Button>
      </div>

      <SectionTitle>Delete account</SectionTitle>
      <Muted>Removes your account and every workspace that only you belong to. Workspaces you share with others stay with them.</Muted>
      <div className={styles.danger}>
        <Button variant="danger" icon={Trash2} disabled={busy} onClick={() => setDeleting(true)}>
          Delete my account
        </Button>
      </div>

      {deleting && (
        <Modal
          title="Delete your account?"
          onClose={() => setDeleting(false)}
          onSubmit={() => void run(() => deleteAccount(confirmPassword), 'Your account was deleted')}
          footer={
            <>
              <Button onClick={() => setDeleting(false)}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={busy || !confirmPassword}>
                Delete account
              </Button>
            </>
          }
        >
          <p>
            Your account and every workspace that only you belong to will be permanently deleted. This cannot be undone. Export a
            workspace first if you might want it back.
          </p>
          <TextField
            label="Your password"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="current-password"
            required
          />
        </Modal>
      )}
    </>
  );
}
