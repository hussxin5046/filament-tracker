import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { findAllByCode, parseScan, type Scan } from '@/lib/scan';
import { createWedge } from '@/lib/wedge';
import styles from '@/components/scan/Scan.module.css';
import { openModalCount } from '@/lib/dialogs';

/** What a scan hands to the page it opens. */
export interface ScanState {
  /** The item was opened by scanning it: its sheet starts ready for the amount used or weighed. */
  fromScan?: boolean;
  /** A code nothing has yet, to start a new item with. */
  newItem?: { sku: string };
}

type Handler = (raw: string) => void;

interface Scanner {
  /** Open what was scanned. "unknown" when it is a code nothing here has. */
  open: (scan: Scan) => 'opened' | 'unknown';
  /** What a barcode scanner's read does when no dialog has asked for scans itself. */
  openRaw: Handler;
  register: (handler: Handler) => () => void;
  /** Hand over a scan read some other way: it goes where a barcode scanner's read would (see handheld mode). */
  dispatch: Handler;
}

const ScannerContext = createContext<Scanner>({ open: () => 'unknown', openRaw: () => undefined, register: () => () => undefined, dispatch: () => undefined });

export const useScanner = () => useContext(ScannerContext);

/**
 * Take over what a barcode scanner reads for as long as the caller is on screen (and `handler` is not null).
 * The newest caller wins, so a dialog opened over another gets the scans.
 */
export function useScanHandler(handler: Handler | null) {
  const { register } = useScanner();
  const latest = useRef(handler);
  latest.current = handler;
  const active = handler !== null;
  useEffect(() => (active ? register((raw) => latest.current?.(raw)) : undefined), [active, register]);
}

type Editable = HTMLInputElement | HTMLTextAreaElement;

const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** The field being typed into, if any. */
function editableOf(target: EventTarget | null): Editable | 'other' | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement) return NOT_TEXT.has(target.type) ? null : target;
  return target instanceof HTMLElement && target.isContentEditable ? 'other' : null;
}

/** Put a field back to what it held, in a way React notices. */
function restore(field: Editable, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Listens for a barcode scanner on every screen. A handheld scanner, or a Zebra mobile computer set to send
 * keystrokes, types the code and presses Enter; that is told apart from a person typing by its speed. A Zebra
 * mobile computer in Chrome instead hands the whole code to the selected field at once: only a field can take
 * it, which is why handheld mode keeps one selected.
 *
 * Where the scan goes depends on what has the focus:
 * - nothing typed into: the scan is acted on;
 * - a field marked data-scan="capture": the field is put back as it was, and the scan is acted on;
 * - any other field: the code stays typed in the field, but its Enter does not submit the form.
 */
export function ScannerProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { canEdit } = useWorkspace();
  const { items } = useItems();
  const { locations } = useCatalog();
  const [unknown, setUnknown] = useState<string | null>(null);
  const handlers = useRef<Handler[]>([]);

  const register = useCallback((handler: Handler) => {
    handlers.current.push(handler);
    return () => {
      handlers.current = handlers.current.filter((other) => other !== handler);
    };
  }, []);

  const open = (scan: Scan): 'opened' | 'unknown' => {
    const state: ScanState = { fromScan: true };
    if (scan.kind === 'openspool') {
      // A spool tag Wrkbench does not know: the inventory offers the spools it could be, or a filled-in form.
      navigate('/inventory', { state: { spoolTag: { record: scan.record, tagId: scan.tagId ?? null } } });
      return 'opened';
    }
    let found = scan;
    if (scan.kind === 'text') {
      const matches = findAllByCode(scan.text, items, locations);
      if (matches.length === 0) return 'unknown';
      if (matches.length > 1) {
        // A maker's barcode is on every spool of the product: show them all and let the person pick.
        navigate(`/inventory?q=${encodeURIComponent(scan.text)}`);
        toast(`${matches.length} items have this code. Pick the one in your hand.`);
        return 'opened';
      }
      found = matches[0];
    }
    if (found.kind === 'item' && items.some((item) => item.id === found.id)) navigate(`/inventory?item=${encodeURIComponent(found.id)}`, { state });
    // Through the link page, which finds the right workspace when the label belongs to another one.
    else if (found.kind === 'item' || found.kind === 'location') navigate(`/${found.kind === 'item' ? 's' : 'l'}/${found.id}`, { state });
    return 'opened';
  };

  const openRaw = (raw: string) => {
    navigator.vibrate?.(40);
    setUnknown(null);
    const scan = parseScan(raw);
    if (open(scan) === 'unknown' && scan.kind === 'text') setUnknown(scan.text);
  };

  /** With no dialog asking for scans: open what was scanned, unless that would happen behind an open dialog. */
  const byDefault = (raw: string) => {
    const dialogs = openModalCount() - (unknown === null ? 0 : 1);
    if (dialogs > 0) toast('Close this first, then scan again.', 'danger');
    else openRaw(raw);
  };

  // The listener and the context outlive renders; they always call the latest functions.
  const latest = useRef({ open, openRaw, byDefault });
  latest.current = { open, openRaw, byDefault };

  useEffect(() => {
    const wedge = createWedge();
    // The field that had the focus when the run of keys began, and what it held then.
    let began: { field: Editable; value: string } | 'other' | null = null;

    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const text = wedge.feed(event.key, event.timeStamp, event.ctrlKey || event.altKey || event.metaKey);
      const editable = editableOf(event.target);
      if (wedge.pending() === 1 && event.key.length === 1) began = editable && editable !== 'other' ? { field: editable, value: editable.value } : editable;

      if (text === null) {
        // Well into a scan with no field to type in: keep its keys from pressing a focused button or scrolling.
        if (!editable && wedge.pending() >= 3) event.preventDefault();
        return;
      }
      // The scanner's Enter must never press a button or submit a form.
      event.preventDefault();
      event.stopPropagation();
      const start = began;
      began = null;
      if (start === 'other') return;
      if (start) {
        if (start.field.dataset.scan !== 'capture') return;
        restore(start.field, start.value);
      }
      const handler = handlers.current.at(-1) ?? latest.current.byDefault;
      handler(text);
    };

    // A Zebra mobile computer in Chrome hands the selected field the whole code at once, then presses Enter.
    const onText = (event: Event) => {
      if (!(event instanceof InputEvent) || event.inputType !== 'insertText' || !event.data) return;
      const editable = editableOf(event.target);
      const starting = wedge.pending() === 0;
      wedge.feedText(event.data, event.timeStamp);
      // Before the text goes in, so a field marked data-scan="capture" can be put back as it was.
      if (starting) began = editable && editable !== 'other' ? { field: editable, value: editable.value } : editable;
    };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('beforeinput', onText, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('beforeinput', onText, true);
    };
  }, []);

  const scanner = useMemo<Scanner>(
    () => ({
      open: (scan) => latest.current.open(scan),
      openRaw: (raw) => latest.current.openRaw(raw),
      register,
      dispatch: (raw) => (handlers.current.at(-1) ?? latest.current.byDefault)(raw),
    }),
    [register],
  );

  const addUnknown = () => {
    const sku = unknown ?? '';
    setUnknown(null);
    navigate('/inventory', { state: { newItem: { sku } } satisfies ScanState });
  };

  return (
    <ScannerContext.Provider value={scanner}>
      {children}
      {unknown !== null && (
        <Modal
          title="No match"
          onClose={() => setUnknown(null)}
          footer={
            <>
              <Button onClick={() => setUnknown(null)}>Close</Button>
              {canEdit && (
                <Button variant="primary" icon={Plus} onClick={addUnknown}>
                  Add item
                </Button>
              )}
            </>
          }
        >
          <p className={styles.note}>
            Nothing here has the code "{unknown.slice(0, 60)}".{canEdit ? ' Add an item with it as its SKU / barcode, and the next scan opens that item.' : ''}
          </p>
        </Modal>
      )}
    </ScannerContext.Provider>
  );
}
