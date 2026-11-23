import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Hand, LayoutDashboard, MapPin, ScanLine, Search } from 'lucide-react';
import { ScannerProvider, useScanHandler, useScanner } from '@/components/scan/ScannerProvider';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { handheldItemPath, handheldLocationPath, readHandheldScan, rememberHandheld } from '@/lib/handheld';
import styles from '@/components/layout/HandheldShell.module.css';
import { openModalCount } from '@/lib/dialogs';

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

  // A Zebra mobile computer in Chrome hands a scan to the selected text field, and drops it when there is none.
  // Chrome only lets it into a field the person tapped, not one selected by the page on its own. So the bar at
  // the top holds a visible box: tapping it once makes scans land. It asks for no on-screen keyboard, and is put
  // back as it was after each scan. The bar shows whether the box has the cursor, so nobody scans into nothing.
  const scanField = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const scanner = useScanner();

  // Whatever lands in the box is a scan. Usually the scanner's keys are read as a scan before they get here (see
  // ScannerProvider), and the box is left empty. When they are not, because the text came in some other form
  // than expected, the box still holds it: read it when Enter comes, or once nothing more has arrived for a
  // moment. Nobody types here (the box asks for no keyboard), so anything in it came from the scanner.
  const settle = useRef(0);
  const readBox = () => {
    window.clearTimeout(settle.current);
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
          inputMode="none"
          data-scan="capture"
          aria-label="Scanner input"
          placeholder={ready ? 'Scan now' : 'Tap here'}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // The page never selects it on its own, only from a tap (see above), so having the cursor is ready.
          onFocus={() => setReady(true)}
          onInput={() => {
            window.clearTimeout(settle.current);
            settle.current = window.setTimeout(readBox, 250);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            readBox();
          }}
          onBlur={(event) => {
            window.clearTimeout(settle.current);
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
