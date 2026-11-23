import { useEffect } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, MapPin, Search } from 'lucide-react';
import { ScannerProvider, useScanHandler } from '@/components/scan/ScannerProvider';
import { useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { handheldItemPath, handheldLocationPath, readHandheldScan, rememberHandheld } from '@/lib/handheld';
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
      <header className={styles.bar}>
        <img src="/icon.svg" alt="" width={24} height={24} />
        <span className={styles.title}>{workspace?.name}</span>
        <Link to="/" className={styles.full} onClick={() => rememberHandheld(false)}>
          <LayoutDashboard size={16} aria-hidden /> Full Wrkbench
        </Link>
      </header>
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
