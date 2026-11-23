import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Hand, LayoutDashboard, MapPin, Nfc, ScanLine, Search } from 'lucide-react';
import { ScannerProvider, useScanHandler, useScanner } from '@/components/scan/ScannerProvider';
import { IconButton } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { handheldItemPath, handheldLocationPath, readHandheldScan, rememberHandheld } from '@/lib/handheld';
import { openModalCount } from '@/lib/dialogs';
import { BAMBU_TAG_NOTE, listenForTags, nfcAvailable, nfcProblem, type TagContents, type TagSession } from '@/lib/nfc';
import { stickerTag } from '@/lib/openspool';
import { parseScan } from '@/lib/scan';
import styles from '@/components/layout/HandheldShell.module.css';

/**
 * The frame of handheld mode: a top bar and the screen below it. No camera and no fields that take the focus
 * on their own, since on a Zebra mobile computer either one stops the built-in scanner from firing.
 */
export function HandheldShell() {
  return (
    <ScannerProvider>
      <HandheldFrame />
    </ScannerProvider>
  );
}

function HandheldFrame() {
  const navigate = useNavigate();
  const toast = useToast();
  const { workspace } = useWorkspace();
  const { items } = useItems();
  const { locations } = useCatalog();

  // Opening handheld mode once makes it what this device opens.
  useEffect(() => rememberHandheld(true), []);

  const scanner = useScanner();

  // ---- NFC: starts from a tap on the button, then every sticker held to the device opens what it is for ----
  const [nfc, setNfc] = useState(false);
  const session = useRef<TagSession | null>(null);
  useEffect(() => () => session.current?.stop(), []);
  const onTag = (contents: TagContents) => {
    // A dialog that reads or writes tags itself (writing a spool's sticker) has them while it is open.
    if (openModalCount() > 0) return;
    navigator.vibrate?.(40);
    const tagId = stickerTag(contents.serial);
    // A sticker written here is known by its serial, whatever it holds now.
    const known = tagId ? items.find((item) => item.tagId === tagId) : undefined;
    if (known) return navigate(handheldItemPath(known.id));
    const linked = contents.url ? parseScan(contents.url) : null;
    if (linked && linked.kind !== 'text') return scanner.dispatch(contents.url!);
    // An OpenSpool tag from elsewhere says only what the filament is: the full inventory offers the spools it
    // could be, or a filled-in form. Handheld mode has no screen for that.
    const data = contents.json ? parseScan(contents.json) : null;
    if (data?.kind === 'openspool') return void scanner.open({ ...data, tagId });
    if (contents.url) return scanner.dispatch(contents.url);
    toast(`This tag is blank, or holds nothing Wrkbench reads. ${BAMBU_TAG_NOTE}`, 'danger');
  };
  const latestTag = useRef(onTag);
  latestTag.current = onTag;
  const toggleNfc = async () => {
    if (session.current) {
      session.current.stop();
      session.current = null;
      setNfc(false);
      return;
    }
    try {
      session.current = await listenForTags((contents) => latestTag.current(contents), (message) => toast(message, 'danger'));
      setNfc(true);
      toast('Ready for NFC tags: hold one to the back of the device.');
    } catch (error) {
      toast(nfcProblem(error), 'danger');
    }
  };

  // A Zebra mobile computer in Chrome hands a scan to the selected text field, and drops it when there is none.
  // Chrome only lets it into a field the person tapped, not one selected by the page on its own. So the bar at
  // the top holds a visible box: tapping it once makes scans land. It is an ordinary box that brings up the
  // on-screen keyboard: on a TC56, scans only arrived in a box that did. The bar shows whether the box has the
  // cursor, so nobody scans into nothing.
  const scanField = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);

  // Once a scan has landed, the keyboard is put away (the box asks for none) while the box keeps the cursor, so
  // the next scan can land too. Tapping the box brings the keyboard back, for typing a code by hand.
  const [keyboard, setKeyboard] = useState(true);
  useEffect(() => {
    // Ahead of ScannerProvider's own listener (this one is added first), which stops the Enter that ends a scan.
    const onEnter = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && event.target === scanField.current) window.setTimeout(() => setKeyboard(false), 0);
    };
    window.addEventListener('keydown', onEnter, true);
    return () => window.removeEventListener('keydown', onEnter, true);
  }, []);

  // What is in the box when Enter comes is a scan (or a code typed by hand). Usually the scanner's keys are read
  // as a scan before they get here (see ScannerProvider), and the box is left empty. When they are not, because
  // the text came in some other form than expected, the box still holds it.
  const readBox = () => {
    const field = scanField.current;
    const text = field?.value.trim() ?? '';
    if (!field || text.length < 4) return;
    field.value = '';
    scanner.dispatch(text);
  };
  useEffect(() => {
    const typingIn = (element: Element | null) =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || (element instanceof HTMLElement && element.isContentEditable);
    const reclaim = () => {
      if (typingIn(document.activeElement) || document.hidden || openModalCount() > 0) return;
      scanField.current?.focus({ preventScroll: true });
    };
    // Straight after a tap on a button or a link, while the tap still counts as the person's own.
    const afterTap = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      reclaim();
    };
    // Only ever from a tap. Selecting it on its own (on load, or when the focus moves away) gets no scans on a
    // TC56, and Chrome there can respond to it by zooming the page onto the field, which hides everything.
    document.addEventListener('click', afterTap);
    return () => document.removeEventListener('click', afterTap);
  }, []);

  // A scan on any handheld screen opens what was scanned, unless that screen is waiting for scans itself.
  useScanHandler((raw) => {
    navigator.vibrate?.(40);
    const found = readHandheldScan(raw, items, locations);
    if (found.kind === 'item') navigate(handheldItemPath(found.item.id));
    else if (found.kind === 'location') navigate(handheldLocationPath(found.location.id));
    else if (found.kind === 'several') {
      navigate(`/handheld?q=${encodeURIComponent(found.text)}`);
      toast(`${found.items.length} items have this code. Pick the one in your hand.`);
    } else toast(found.message, 'danger');
  });

  return (
    <div className={styles.shell}>
      <div className={styles.top}>
      <header className={styles.bar}>
        <img src="/icon.svg" alt="" width={24} height={24} />
        <span className={styles.title}>{workspace?.name}</span>
        {nfcAvailable() && (
          <IconButton icon={Nfc} label={nfc ? 'Stop reading NFC tags' : 'Read NFC tags'} aria-pressed={nfc} className={nfc ? styles.nfcOn : undefined} onClick={() => void toggleNfc()} />
        )}
        <Link to="/" className={styles.full} onClick={() => rememberHandheld(false)}>
          <LayoutDashboard size={16} aria-hidden /> Full Wrkbench
        </Link>
      </header>
      <label className={`${styles.ready} ${ready ? styles.isReady : styles.notReady}`}>
        <span className={styles.readyText}>
          {ready ? <ScanLine size={18} aria-hidden /> : <Hand size={18} aria-hidden />}
          {ready ? 'Ready to scan' : 'Tap the box, then scan'}
        </span>
        <input
          ref={scanField}
          className={styles.scanField}
          enterKeyHint="go"
          inputMode={keyboard ? undefined : 'none'}
          data-scan="capture"
          aria-label="Scanner input"
          placeholder={ready ? 'Scan now' : 'Tap here'}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // The page never selects it on its own, only from a tap (see above), so having the cursor is ready.
          onFocus={() => setReady(true)}
          onClick={() => setKeyboard(true)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            readBox();
          }}
          onBlur={(event) => {
            event.currentTarget.value = '';
            setReady(false);
          }}
        />
      </label>
      </div>
      <main className={styles.main}>
        <Outlet />
      </main>
      <nav className={styles.tabs} aria-label="Handheld">
        <NavLink to="/handheld" end className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}>
          <Search size={20} aria-hidden /> Find
        </NavLink>
        <NavLink to="/handheld/locations" className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}>
          <MapPin size={20} aria-hidden /> Locations
        </NavLink>
      </nav>
    </div>
  );
}
