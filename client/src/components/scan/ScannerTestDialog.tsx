import { useEffect, useRef, useState } from 'react';
import { Copy, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useScanHandler } from '@/components/scan/ScannerProvider';
import { keyReport, MAX_RECORDS, type KeyRecord } from '@/lib/keyLog';
import styles from '@/components/scan/Scan.module.css';

const EVENTS = ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'] as const;

/**
 * Shows exactly what a barcode scanner sends the browser, for when scans do nothing. Every key press and every bit
 * of typed text is listed with the pause before it, along with what Wrkbench read as a scan. Scans are not acted
 * on while this is open.
 */
export function ScannerTestDialog({ onClose }: { onClose: () => void }) {
  const [records, setRecords] = useState<KeyRecord[]>([]);
  const [typed, setTyped] = useState('');
  const [copied, setCopied] = useState('');
  const reportRef = useRef<HTMLTextAreaElement>(null);

  const add = (record: KeyRecord) => setRecords((current) => [...current, record].slice(-MAX_RECORDS));

  // What Wrkbench reads as a scan comes here instead of opening anything.
  useScanHandler((raw) => add({ type: 'scan', at: performance.now(), where: 'page', data: raw }));

  useEffect(() => {
    const listen = (event: Event) => {
      const where = event.target instanceof HTMLElement && event.target.dataset.scanTest === 'box' ? 'box' : event.target === reportRef.current ? 'report' : 'page';
      const record: KeyRecord = { type: event.type, at: event.timeStamp, where };
      if (event instanceof KeyboardEvent) {
        record.key = event.key;
        record.code = event.code;
        record.keyCode = event.keyCode;
        record.composing = event.isComposing;
        record.modifiers = [event.ctrlKey && 'ctrl', event.altKey && 'alt', event.metaKey && 'meta', event.shiftKey && 'shift'].filter(Boolean).join('+');
        // A scan that is not read still ends with Enter, which must not press the focused button and close this.
        if (event.type === 'keydown' && event.key === 'Enter' && where === 'page') event.preventDefault();
      } else if (event instanceof InputEvent) {
        record.inputType = event.inputType;
        record.data = event.data;
        record.composing = event.isComposing;
      } else if (event instanceof CompositionEvent) {
        record.data = event.data;
      }
      add(record);
    };
    for (const type of EVENTS) window.addEventListener(type, listen, true);
    return () => {
      for (const type of EVENTS) window.removeEventListener(type, listen, true);
    };
  }, []);

  const report = keyReport(records, navigator.userAgent);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied('Copied.');
      return;
    } catch {
      // No clipboard at an address that is not https: select the text and use the older way.
    }
    reportRef.current?.select();
    setCopied(document.execCommand('copy') ? 'Copied.' : 'Could not copy. Select the text above and copy it.');
  };

  const clear = () => {
    setRecords([]);
    setTyped('');
    setCopied('');
  };

  return (
    <Modal
      title="Scanner test"
      onClose={onClose}
      footer={
        <>
          <Button icon={RotateCcw} onClick={clear}>
            Clear
          </Button>
          <Button variant="primary" icon={Copy} onClick={() => void copy()} disabled={records.length === 0}>
            Copy
          </Button>
        </>
      }
    >
      <p className={styles.note}>
        Scan a label. Then tap the box below and scan the same label again. Tap Copy and send what it shows to whoever helps you set up the scanner.
        Nothing opens while this is open.
      </p>
      <TextField label="Scan into this box" value={typed} onChange={setTyped} data-scan-test="box" autoComplete="off" autoCapitalize="off" />
      <textarea ref={reportRef} className={styles.report} readOnly rows={12} value={report} aria-label="What the scanner sent" />
      {copied && <p className={styles.note}>{copied}</p>}
    </Modal>
  );
}
