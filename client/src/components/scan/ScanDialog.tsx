import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, CircleAlert, CircleCheck, Nfc, ScanBarcode } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useScanHandler, useScanner } from '@/components/scan/ScannerProvider';
import { ScannerTestDialog } from '@/components/scan/ScannerTestDialog';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { cameraAvailable, cameraProblem, startScanner } from '@/lib/camera';
import { BAMBU_TAG_NOTE, listenForTags, nfcAvailable, nfcProblem, type TagContents, type TagSession } from '@/lib/nfc';
import { stickerTag } from '@/lib/openspool';
import { findByCode, parseScan, type Scan } from '@/lib/scan';
import styles from '@/components/scan/Scan.module.css';

/**
 * On a mobile computer with a scanner built in (a Zebra TC56, for one), the scanner does not fire while the
 * browser has the camera open. Turning the camera off is remembered on the device, for every Scan window.
 */
const CAMERA_KEY = 'wrkbench.scanCamera';

function cameraWanted(): boolean {
  try {
    return localStorage.getItem(CAMERA_KEY) !== 'off';
  } catch {
    return true;
  }
}

function rememberCamera(on: boolean) {
  try {
    if (on) localStorage.removeItem(CAMERA_KEY);
    else localStorage.setItem(CAMERA_KEY, 'off');
  } catch {
    // Not remembered: it applies to this Scan window only.
  }
}

export interface ScanNote {
  text: string;
  tone?: 'ok' | 'danger';
}

interface Props {
  title?: string;
  /** One line above the camera saying what to scan. */
  hint?: string;
  onClose: () => void;
  /**
   * Handle each scan and keep the scanner open, for doing the same thing to many labels in a row.
   * Return a line saying what happened. Without this, a scan opens the item or location and closes.
   */
  onScan?: (scan: Scan) => Promise<ScanNote> | ScanNote;
}

/** What a scan of a spool tag hands to the inventory page, which offers the spools it could be or a filled-in form. */
export interface SpoolTagState {
  spoolTag: { record: Record<string, unknown>; tagId: string | null };
}

/**
 * Point the camera at a label. Codes can also be typed or pasted, which is what is left when there is no camera
 * to use. A barcode scanner needs none of this (see ScannerProvider), but its reads land here while this is open.
 */
export function ScanDialog({ title = 'Scan a label', hint, onClose, onScan }: Props) {
  const scanner = useScanner();
  const { items } = useItems();
  const { locations } = useCatalog();
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState('');
  const [testing, setTesting] = useState(false);
  const [typed, setTyped] = useState('');
  const [log, setLog] = useState<Array<ScanNote & { id: number }>>([]);
  const nextId = useRef(1);
  const hasCamera = cameraAvailable();
  const [cameraOn, setCameraOn] = useState(cameraWanted);
  // The scanner test needs the built-in scanner, which cannot fire while the camera is open.
  const showCamera = hasCamera && cameraOn && !testing;

  const switchCamera = (on: boolean) => {
    rememberCamera(on);
    setProblem('');
    setCameraOn(on);
  };

  const note = (entry: ScanNote) => setLog((current) => [{ ...entry, id: nextId.current++ }, ...current].slice(0, 30));

  const handle = async (raw: string) => {
    let scan = parseScan(raw);
    // A plain code may be an item's SKU or barcode, or a location's own label code. Opening looks it up itself,
    // since several items can share a maker's barcode.
    if (onScan && scan.kind === 'text') scan = findByCode(scan.text, items, locations) ?? scan;
    await act(scan);
  };

  const act = async (scan: Scan) => {
    navigator.vibrate?.(40);
    if (onScan) {
      try {
        note(await onScan(scan));
      } catch (error) {
        note({ text: error instanceof Error ? error.message : 'Something went wrong', tone: 'danger' });
      }
      return;
    }
    if (scanner.open(scan) === 'opened') onClose();
    else note({ text: `Nothing here has the code "${scan.kind === 'text' ? scan.text.slice(0, 60) : ''}".`, tone: 'danger' });
  };
  // The camera loop outlives renders; it always calls the latest handler.
  const latest = useRef(handle);
  latest.current = handle;
  // A barcode scanner's reads come here while the dialog is open, whatever has the focus.
  useScanHandler((raw) => void handle(raw));

  useEffect(() => {
    if (!showCamera || !video.current) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    startScanner(video.current, (text) => void latest.current(text))
      .then((started) => {
        if (cancelled) started();
        else stop = started;
      })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(cameraProblem(error));
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [showCamera]);

  // ---- NFC (Chrome on Android): starts from a tap, then every tag held to the phone is read ----
  const [nfc, setNfc] = useState<'off' | 'on'>('off');
  const session = useRef<TagSession | null>(null);
  useEffect(() => () => session.current?.stop(), []);

  const onTag = (contents: TagContents) => {
    const tagId = stickerTag(contents.serial);
    // A sticker written here is known by its serial, whatever it holds now.
    const known = tagId ? items.find((item) => item.tagId === tagId) : undefined;
    if (known) return void act({ kind: 'item', id: known.id });
    const linked = contents.url ? parseScan(contents.url) : null;
    if (linked && linked.kind !== 'text') return void act(linked);
    const data = contents.json ? parseScan(contents.json) : null;
    if (data?.kind === 'openspool') return void act({ ...data, tagId });
    note({ text: `This tag is blank, or holds nothing Wrkbench reads. To write a sticker, open a spool and choose "Spool tag". ${BAMBU_TAG_NOTE}`, tone: 'danger' });
  };
  const latestTag = useRef(onTag);
  latestTag.current = onTag;

  const startNfc = async () => {
    try {
      session.current = await listenForTags((contents) => latestTag.current(contents), (message) => note({ text: message, tone: 'danger' }));
      setNfc('on');
    } catch (error) {
      note({ text: nfcProblem(error), tone: 'danger' });
    }
  };

  const submitTyped = () => {
    if (!typed.trim()) return;
    void handle(typed);
    setTyped('');
  };

  return (
    <>
    <Modal title={title} onClose={onClose} onSubmit={submitTyped} footer={<Button onClick={onClose}>{onScan ? 'Done' : 'Close'}</Button>}>
      {hint && <p className={styles.note}>{hint}</p>}
      {hasCamera && !cameraOn ? (
        <div className={styles.cameraOff}>
          <p className={styles.note}>The camera is off on this device, so a scanner built into it can fire.</p>
          <Button size="sm" icon={Camera} onClick={() => switchCamera(true)}>
            Use camera
          </Button>
        </div>
      ) : showCamera && !problem ? (
        <>
          <div className={styles.viewport}>
            <video ref={video} className={styles.video} muted playsInline aria-label="Camera" />
            <span className={styles.frame} aria-hidden />
          </div>
          <Button variant="ghost" size="sm" icon={CameraOff} className={styles.testLink} onClick={() => switchCamera(false)}>
            Turn off camera (for a device with a scanner built in)
          </Button>
        </>
      ) : testing ? null : (
        <p className={styles.note}>{problem || 'The camera only works when Wrkbench is opened at a secure (https) address. You can still type or paste a code below.'}</p>
      )}
      <div className={styles.typed}>
        <TextField label="Or type a code" value={typed} onChange={setTyped} placeholder="Label code, SKU, barcode or pasted tag contents" autoComplete="off" autoCapitalize="off" enterKeyHint="go" data-scan="capture" />
        <Button type="submit" disabled={!typed.trim()}>
          Find
        </Button>
      </div>
      {nfcAvailable() &&
        (nfc === 'on' ? (
          <p className={styles.nfc}>
            <Nfc size={18} aria-hidden /> Ready for an NFC tag: hold it against the back of the phone
          </p>
        ) : (
          <Button icon={Nfc} onClick={startNfc}>
            Read an NFC tag
          </Button>
        ))}
      {log.length > 0 && (
        <ul className={styles.log} aria-live="polite">
          {log.map((entry) => (
            <li key={entry.id} className={`${styles.entry} ${entry.tone === 'danger' ? styles.danger : styles.ok}`}>
              {entry.tone === 'danger' ? <CircleAlert size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
              {entry.text}
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="sm" icon={ScanBarcode} className={styles.testLink} onClick={() => setTesting(true)}>
        Barcode scanner not working? Test it
      </Button>
    </Modal>
    {testing && <ScannerTestDialog onClose={() => setTesting(false)} />}
    </>
  );
}
