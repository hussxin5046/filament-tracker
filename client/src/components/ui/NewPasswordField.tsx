import { useEffect, useId, useState, type InputHTMLAttributes } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import { Field } from '@/components/ui/Form';
import { loadCommonPasswords, PASSWORD_HINT, passwordNote, type Owner } from '@/lib/passwordRules';
import formStyles from '@/components/ui/Form.module.css';
import styles from '@/components/ui/NewPasswordField.module.css';

interface NewPasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Whose password it is, when known, so one made from their own name or address is caught while typing. */
  owner?: Owner;
  /** A password the server has just refused. While the field still holds it, the tick is not shown. */
  refused?: string | null;
  /** Added after the rules in the hint, e.g. what else choosing this password does. */
  hintAfter?: string;
}

/**
 * A field for a password being chosen (not one being typed to sign in). Before anything is typed it shows the
 * rules; from then on, how the password is doing against them. The server has the last word.
 */
export function NewPasswordField({ label, value, onChange, owner, refused, hintAfter, ...rest }: NewPasswordFieldProps) {
  const noteId = useId();
  const [common, setCommon] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    let current = true;
    loadCommonPasswords().then(
      (list) => {
        if (current) setCommon(list);
      },
      () => {
        /* Without the list, the server still refuses a common password. */
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const verdict = passwordNote(value, owner, common);
  // "Long enough" beside a refusal for some other reason (a leak, say) would contradict it.
  const note = verdict?.tone === 'good' && value === refused ? null : verdict;
  const Icon = note?.tone === 'good' ? Check : note?.tone === 'bad' ? CircleAlert : null;

  return (
    <Field label={label}>
      {(id) => (
        <div className={styles.stack}>
          <input
            id={id}
            className={formStyles.input}
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-describedby={noteId}
            aria-invalid={note?.tone === 'bad' || undefined}
            {...rest}
          />
          {/* The countdown changes with every key, so it is not read out; a verdict is. */}
          <p id={noteId} className={`${styles.note} ${note ? styles[note.tone] : ''}`} aria-live={note && note.tone !== 'quiet' ? 'polite' : 'off'}>
            {Icon && <Icon size={14} aria-hidden />}
            <span>{note ? note.text : hintAfter ? `${PASSWORD_HINT} ${hintAfter}` : PASSWORD_HINT}</span>
          </p>
        </div>
      )}
    </Field>
  );
}
