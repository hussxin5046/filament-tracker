import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, Boxes, Eye, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, ScanLine, Search, Settings, Sunrise,
  Smartphone,
} from 'lucide-react';
import { CommandMenu } from '@/components/layout/CommandMenu';
import { ConfirmEmailNotice } from '@/components/layout/ConfirmEmailNotice';
import { NAV_PAGES, type NavPage } from '@/components/layout/navPages';
import { DailyReport, useDailyReport } from '@/components/report/DailyReport';
import { ScanDialog } from '@/components/scan/ScanDialog';
import { ScannerProvider } from '@/components/scan/ScannerProvider';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Kbd } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useAuth } from '@/context/AuthContext';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useItems } from '@/hooks/useCatalog';
import type { Command } from '@/lib/commands';
import { applyLayout, normalizeLayout, type NavId } from '@/lib/navigation';
import { isApple, isShortcut, SEARCH_SHORTCUT, shortcutLabel } from '@/lib/shortcuts';
import { navigateWithTransition, pageArrived } from '@/lib/viewTransition';
import type { Dashboard, JobRequest, MaintenanceData, ReorderData } from '@/lib/types';
import { SETTINGS_TABS } from '@/pages/SettingsPage';
import styles from '@/components/layout/AppShell.module.css';
import { openModalCount } from '@/lib/dialogs';

interface NavItem extends NavPage {
  /** Shown in the phone tab bar; the rest live under "More". */
  primary: boolean;
  desktop: boolean;
  phone: boolean;
  alert?: number;
}

const NEW_WORKSPACE = '__new__';
const SIDEBAR_KEY = 'filament-tracker.sidebar-collapsed';

/** Desktop sidebar: full width, or a narrow icon rail. Remembered per browser. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((was) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, was ? '0' : '1');
      } catch {
        /* storage unavailable: the choice just lasts this visit */
      }
      return !was;
    });
  return [collapsed, toggle] as const;
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { workspace, workspaces, select, canOperate } = useWorkspace();
  const { data: dashboard } = useWsQuery<Dashboard>('/dashboard');
  const { data: maintenance } = useWsQuery<MaintenanceData>('/maintenance');
  const { data: reorder } = useWsQuery<ReorderData>('/reorder');
  const { data: requests } = useWsQuery<JobRequest[]>('/job-requests');
  const { items: stock } = useItems();
  const { machine, relates } = useMachineFocus();
  const [moreOpen, setMoreOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [searching, setSearching] = useState(false);
  const [collapsed, toggleSidebar] = useSidebarCollapsed();
  const report = useDailyReport();
  const navigate = useNavigate();
  // A page reached from the navigation cross-fades in; this tells the fade the new page has been drawn.
  const navigationKey = useLocation().key;
  useLayoutEffect(pageArrived, [navigationKey]);

  // The badges follow the focus: with one machine picked they count only what concerns it.
  const related = new Set(stock.filter(relates).map((item) => item.id));
  const overdue = machine
    ? maintenance?.schedule.filter((entry) => entry.machineId === machine.id && entry.status === 'overdue').length
    : dashboard?.counts.overdue;
  const toReorder = machine
    ? reorder?.groups.reduce((sum, group) => sum + group.lines.filter((line) => related.has(line.itemId)).length, 0)
    : dashboard && dashboard.counts.lowStock + dashboard.counts.wornTools;
  const waiting = requests?.filter((request) => request.status === 'pending' && (!machine || request.machine?.id === machine.id)).length;

  // Order, tab bar and which pages show on each device are the user's own (Settings, Navigation); the badges stay with their page wherever it moves.
  const alerts: Partial<Record<NavId, number | undefined>> = { jobs: waiting, maintenance: overdue, reorder: toReorder };
  const items: NavItem[] = applyLayout(NAV_PAGES, normalizeLayout(user?.navigation)).map((page) => ({ ...page, alert: alerts[page.id] }));

  const switchWorkspace = (id: string) => {
    setMoreOpen(false);
    if (id === NEW_WORKSPACE) navigate('/new-workspace');
    else {
      select(id);
      navigate('/');
    }
  };

  // The command menu opens from anywhere with its shortcut, typing in a field included. Not over another dialog:
  // going somewhere else from behind one would leave it stranded.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event, SEARCH_SHORTCUT)) return;
      event.preventDefault();
      setSearching((open) => (open ? false : openModalCount() === 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Everything the command menu offers besides the inventory: every page whatever the user's own navigation
  // shows, each Settings section, and the actions that live in this shell.
  const commands: Command[] = [
    ...NAV_PAGES.map((page) => ({ id: `page:${page.id}`, label: page.label, group: 'Go to', icon: page.icon, run: () => navigate(page.to) })),
    ...SETTINGS_TABS.map((tab) => ({ id: `settings:${tab.id}`, label: `Settings: ${tab.label}`, group: 'Go to', icon: Settings, run: () => navigate(`/settings?tab=${tab.id}`) })),
    { id: 'do:scan', label: 'Scan a label', group: 'Do', icon: ScanLine, keywords: 'qr barcode nfc camera', run: () => setScanning(true) },
    { id: 'do:handheld', label: 'Handheld mode', group: 'Do', icon: Smartphone, keywords: 'zebra scanner tc56 mobile computer simple', run: () => navigate('/handheld') },
    { id: 'do:report', label: 'Open the daily report', group: 'Do', icon: Sunrise, keywords: 'today summary', run: () => report.show() },
    ...workspaces
      .filter((w) => w.id !== workspace?.id)
      .map((w) => ({ id: `workspace:${w.id}`, label: `Switch to ${w.name}`, group: 'Do', icon: ArrowLeftRight, keywords: 'workspace change', run: () => switchWorkspace(w.id) })),
    { id: 'do:new-workspace', label: 'New workspace', group: 'Do', icon: Plus, keywords: 'create add', run: () => switchWorkspace(NEW_WORKSPACE) },
    { id: 'do:sign-out', label: 'Sign out', group: 'Do', icon: LogOut, keywords: 'log out leave', run: logout },
  ];

  // The way in for anyone who has not learnt the shortcut, which it shows.
  const searchButton = (
    <button
      type="button"
      className={`${styles.navLink} ${styles.navButton}`}
      title={collapsed ? `Search (${shortcutLabel(SEARCH_SHORTCUT)})` : undefined}
      aria-keyshortcuts={isApple() ? 'Meta+K' : 'Control+K'}
      onClick={() => setSearching(true)}
    >
      <Search size={20} aria-hidden />
      <span className={styles.linkLabel}>Search</span>
      <span className={styles.shortcut}>
        <Kbd>{shortcutLabel(SEARCH_SHORTCUT)}</Kbd>
      </span>
    </button>
  );

  const switcher = (
    <label className={styles.switcher}>
      <span className={styles.switcherLabel}>Workspace</span>
      <Select icon={Boxes} className={styles.switcherSelect} value={workspace?.id ?? ''} onChange={(e) => switchWorkspace(e.target.value)}>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
        <option value={NEW_WORKSPACE}>+ New workspace…</option>
      </Select>
    </label>
  );

  const link = (item: NavItem, className: string, onClick?: () => void) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === '/'}
      onClick={(event) => {
        onClick?.();
        // An ordinary click cross-fades to the page. Anything else (a new tab, a new window) is left to the browser.
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigateWithTransition(() => navigate(item.to));
      }}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => `${className} ${isActive ? styles.active : ''}`}
    >
      <item.icon size={20} aria-hidden />
      <span className={styles.linkLabel}>{item.label}</span>
      {item.alert ? <span className={styles.alert}>{item.alert}</span> : null}
    </NavLink>
  );

  // Not a screen of its own: the report opens over whatever is on screen, and by itself on the first visit of the day.
  const reportButton = (onClick?: () => void) => (
    <button
      type="button"
      className={`${styles.navLink} ${styles.navButton}`}
      title={collapsed ? 'Daily report' : undefined}
      onClick={() => {
        onClick?.();
        report.show();
      }}
    >
      <Sunrise size={20} aria-hidden />
      <span className={styles.linkLabel}>Daily report</span>
    </button>
  );

  // Scanning a label is how you get to an item or a location with your hands full: always one tap away.
  const scanButton = (className: string) => (
    <button type="button" className={`${styles.navLink} ${styles.navButton} ${className}`} title={collapsed ? 'Scan a label' : undefined} onClick={() => setScanning(true)}>
      <ScanLine size={20} aria-hidden />
      <span className={styles.linkLabel}>Scan</span>
    </button>
  );

  // A guest has no email to show; offer the way to keep what they have set up instead.
  const keepWork = (onNavigate?: () => void) => (
    <Link to="/register" className={styles.accountLink} onClick={onNavigate}>
      Create account to keep this
    </Link>
  );

  return (
    <ScannerProvider>
    <div className={`${styles.shell} ${collapsed ? styles.collapsed : ''}`}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img className={styles.brandIcon} src="/icon.svg" alt="" width={28} height={28} />
          <span className={styles.brandName}>Wrkbench</span>
          <IconButton
            className={styles.sidebarToggle}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            size="sm"
            onClick={toggleSidebar}
          />
        </div>
        {!collapsed && switcher}
        <nav className={styles.nav} aria-label="Main">
          {searchButton}
          {items.filter((i) => i.desktop).map((item) => link(item, styles.navLink))}
          {scanButton(styles.navEnd)}
          {reportButton()}
        </nav>
        <div className={styles.account}>
          <div className={styles.accountText}>
            <span className={styles.accountName}>{user?.name}</span>
            {user?.isGuest ? keepWork() : <span className={styles.accountRole}>{workspace?.role}</span>}
          </div>
          {collapsed ? (
            <IconButton icon={LogOut} label="Sign out" size="sm" onClick={logout} />
          ) : (
            <Button variant="ghost" size="sm" icon={LogOut} onClick={logout}>
              Sign out
            </Button>
          )}
        </div>
      </aside>

      <header className={styles.topbar}>
        <img src="/icon.svg" alt="" width={26} height={26} />
        <span className={styles.topbarTitle}>{workspace?.name}</span>
        {!canOperate && (
          <Badge tone="info" icon={Eye}>
            View only
          </Badge>
        )}
        <IconButton icon={Search} label="Search" onClick={() => setSearching(true)} />
        <IconButton icon={ScanLine} label="Scan a label" onClick={() => setScanning(true)} />
      </header>

      <main className={styles.main}>
        <div className={styles.content}>
          {!canOperate && (
            <p className={styles.viewerNote}>
              <Eye size={16} aria-hidden /> You have view-only access to this workspace.
            </p>
          )}
          <ConfirmEmailNotice />
          <Outlet />
        </div>
      </main>

      <nav className={styles.tabbar} aria-label="Main">
        {items.filter((i) => i.primary).map((item) => link(item, styles.tab))}
        <button type="button" className={styles.tab} onClick={() => setMoreOpen(true)}>
          <Menu size={20} aria-hidden />
          <span className={styles.linkLabel}>More</span>
          {items.some((i) => !i.primary && i.phone && i.alert) && <span className={styles.alertDot} aria-label="Needs attention" />}
        </button>
      </nav>

      {moreOpen && (
        <Modal title="More" onClose={() => setMoreOpen(false)}>
          {switcher}
          <div className={styles.moreLinks}>
            {items.filter((i) => !i.primary && i.phone).map((item) => link(item, styles.navLink, () => setMoreOpen(false)))}
            {reportButton(() => setMoreOpen(false))}
          </div>
          <Button icon={Plus} onClick={() => switchWorkspace(NEW_WORKSPACE)}>
            New workspace
          </Button>
          <Button
            icon={Smartphone}
            onClick={() => {
              setMoreOpen(false);
              navigate('/handheld');
            }}
          >
            Handheld mode (for a scanner)
          </Button>
          <div className={styles.account}>
            <div className={styles.accountText}>
              <span className={styles.accountName}>{user?.name}</span>
              {user?.isGuest ? keepWork(() => setMoreOpen(false)) : <span className={styles.accountEmail}>{user?.email}</span>}
            </div>
            <Button variant="ghost" size="sm" icon={LogOut} onClick={logout}>
              Sign out
            </Button>
          </div>
        </Modal>
      )}

      {searching && <CommandMenu commands={commands} onClose={() => setSearching(false)} />}
      {scanning && <ScanDialog onClose={() => setScanning(false)} />}
      {report.mode !== 'closed' && <DailyReport auto={report.mode === 'auto'} onClose={report.close} />}
    </div>
    </ScannerProvider>
  );
}
