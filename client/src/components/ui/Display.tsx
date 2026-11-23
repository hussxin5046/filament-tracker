import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, LoaderCircle, type LucideIcon } from 'lucide-react';
import { FocusPicker } from '@/components/layout/FocusPicker';
import { iconFor, toneFor } from '@/lib/icons';
import { withViewTransition } from '@/lib/viewTransition';
import styles from '@/components/ui/Display.module.css';

export type StatusTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';

export function Badge({ tone = 'neutral', icon: Icon, children }: { tone?: StatusTone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  );
}

/**
 * Category marker: the workspace-chosen icon in muted ink. Colour belongs to state, so the
 * workspace-chosen tone only shows with `toned`, where the colour itself is the subject (choosing or editing a type).
 */
export function TypeIcon({ icon, tone, size = 'md', toned = false }: { icon: string | null | undefined; tone?: string | null; size?: 'sm' | 'md' | 'lg'; toned?: boolean }) {
  const Icon = iconFor(icon);
  return (
    <span className={`${styles.typeIcon} ${toned ? styles[`tone-${toneFor(tone)}`] : styles.typeIconPlain} ${styles[`icon-${size}`]}`} aria-hidden>
      <Icon size={size === 'lg' ? 22 : size === 'sm' ? 14 : 18} />
    </span>
  );
}

/** A user-entered colour. Drawn as SVG so the value is an attribute rather than a style. */
export function Swatch({ color, size = 16, label }: { color: string; size?: number; label?: string }) {
  return (
    <svg className={styles.swatch} width={size} height={size} viewBox="0 0 16 16" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="8" cy="8" r="7" fill={color} />
      <circle cx="8" cy="8" r="7" className={styles.swatchRing} />
    </svg>
  );
}

const TICKS = Array.from({ length: 21 }, (_, i) => i * 5);
const COMPACT_TICKS = [0, 25, 50, 75, 100];
const pct = (n: number) => `${n}%`;
/** Matches --duration-gauge and --ease. Script-driven animation skips CSS, so reduced motion is checked by hand. */
const SWEEP: KeyframeAnimationOptions = { duration: 240, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' };
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The ruler gauge: one visual for every "how much is left before X" question.
 * Ticks every 5% (quarters when compact), an orange needle at the current value, and an optional
 * notch at a threshold (minimum stock, service due). Drawn as SVG so positions are attributes, not inline styles.
 */
export function Meter({ value, max, tone = 'accent', label, threshold, compact = false }: { value: number; max: number; tone?: StatusTone; label: string; threshold?: number; compact?: boolean }) {
  const scale = max > 0 ? max : 1;
  const clamped = Math.max(0, Math.min(value, scale));
  const at = (clamped / scale) * 100;
  const notch = threshold !== undefined && threshold > 0 && threshold <= scale ? (threshold / scale) * 100 : null;
  const gauge = useRef<SVGSVGElement>(null);
  const fill = useRef<SVGRectElement>(null);
  const needle = useRef<SVGGElement>(null);
  const shown = useRef<number | null>(null);

  // A gauge is drawn still where it first appears. When its reading changes (stock adjusted, a service logged,
  // a teammate's edit arriving live) the fill and needle travel together from wherever the needle is on screen
  // right now, so a second change mid-sweep carries on smoothly instead of jumping back.
  // Web Animations on transforms: a row that moves in its list keeps the sweep.
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = at;
    const svg = gauge.current;
    const g = needle.current;
    const rect = fill.current;
    if (previous === null || !svg || !g || !rect || prefersReducedMotion() || !g.animate) return;
    const box = svg.getBoundingClientRect();
    const toX = (at / 100) * box.width;
    // The new attributes are already committed, so start from the previous reading. Mid-sweep, the running
    // transform is still an offset from that previous reading, so add what is left of it, then cancel.
    const previousX = (previous / 100) * box.width;
    const inFlight = g.getAnimations().length > 0;
    const needleBox = g.getBoundingClientRect();
    const offset = inFlight ? needleBox.left + needleBox.width / 2 - box.left - toX : 0;
    const fromX = previousX + offset;
    const scale = inFlight && rect.getAnimations().length && toX > 0 ? rect.getBoundingClientRect().width / toX : 1;
    const fromWidth = previousX * scale;
    for (const running of [...g.getAnimations(), ...rect.getAnimations()]) running.cancel();
    if (Math.abs(fromX - toX) < 0.5) return;
    g.animate([{ transform: `translateX(${fromX - toX}px)` }, { transform: 'translateX(0)' }], SWEEP);
    if (toX > 0) rect.animate([{ transform: `scaleX(${fromWidth / toX})` }, { transform: 'scaleX(1)' }], SWEEP);
  }, [at]);

  return (
    <span className={`${styles.meter} ${styles[`meter-${tone}`]}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={scale} aria-valuenow={clamped}>
      <svg ref={gauge} width="100%" height="14" aria-hidden focusable="false" overflow="visible">
        {(compact ? COMPACT_TICKS : TICKS).map((t) => (
          <line key={t} className={styles.meterTick} x1={pct(t)} x2={pct(t)} y1="0" y2={t % 50 === 0 ? 5 : t % 10 === 0 ? 3.5 : 2} />
        ))}
        <rect className={styles.meterTrack} x="0" y="7" width="100%" height="5" />
        <rect ref={fill} className={styles.meterFill} x="0" y="7" width={pct(at)} height="5" />
        {notch !== null && (
          <svg x={pct(notch)} y="0" overflow="visible">
            <path className={styles.meterNotch} d="M-3.5 0 H3.5 L0 5 Z" />
            <line className={styles.meterNotchLine} x1="0" x2="0" y1="5" y2="12" />
          </svg>
        )}
        <svg x={pct(at)} y="0" overflow="visible">
          <g ref={needle}>
            <line className={styles.meterNeedle} x1="0" x2="0" y1="4" y2="14" />
          </g>
        </svg>
      </svg>
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`${styles.card} ${styles.padded} ${className}`}>{children}</section>;
}

export function SectionTitle({ children, action, count }: { children: ReactNode; action?: ReactNode; count?: number }) {
  return (
    <div className={styles.sectionTitle}>
      <h2 className={styles.sectionHeading}>
        {children}
        {count !== undefined && <span className={styles.count}>{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
      </div>
      <div className={styles.pageActions}>
        <FocusPicker />
        {actions}
      </div>
    </header>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <h3 className={styles.emptyTitle}>
        <Icon size={18} aria-hidden />
        {title}
      </h3>
      {children && <p className={styles.emptyText}>{children}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

/** Shown only once a load has taken 300 ms, so quick loads do not flash a spinner. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 300);
    return () => window.clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <div className={styles.loading} role="status">
      <LoaderCircle size={20} className={styles.spin} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

/** A grey block standing in for a line of text while it loads. */
function Bone({ size }: { size: 'sm' | 'md' | 'lg' | 'title' | 'chip' }) {
  return <span className={`${styles.bone} ${styles[`bone-${size}`]}`} />;
}

const BONE_WIDTHS = ['lg', 'md', 'lg', 'sm', 'md'] as const;

interface PageSkeletonProps {
  /** The page's real title: it is known before the data is, so it never moves. */
  title: string;
  /** The real subtitle when it does not depend on the data; otherwise a grey line holds its place. */
  subtitle?: string;
  /** What the page's content is shaped like once loaded. */
  layout?: 'list' | 'cards';
  /** A row of filter chips or tabs sits above the content. */
  filters?: boolean;
  count?: number;
}

/**
 * A page while its data loads: grey blocks laid out by the same header, list, row and card components the
 * loaded page uses, so nothing jumps when the content arrives. Like Loading, it waits 300 ms before showing.
 */
export function PageSkeleton({ title, subtitle, layout = 'list', filters = false, count = 6 }: PageSkeletonProps) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 300);
    return () => window.clearTimeout(timer);
  }, []);
  const places = Array.from({ length: count }, (_, i) => i);
  return (
    <>
      <PageHeader title={title} subtitle={subtitle ?? (slow ? <Bone size="lg" /> : undefined)} />
      {slow && (
        <div className={styles.skeleton} role="status" aria-label={`Loading ${title.toLowerCase()}`}>
          {filters && (
            <div className={styles.chipRow} aria-hidden>
              <Bone size="chip" />
              <Bone size="chip" />
              <Bone size="chip" />
            </div>
          )}
          {layout === 'list' ? (
            <List>
              {places.map((i) => (
                <Row key={i} title={<Bone size={BONE_WIDTHS[i % BONE_WIDTHS.length]} />} subtitle={<Bone size="sm" />} />
              ))}
            </List>
          ) : (
            <Grid>
              {places.map((i) => (
                <Card key={i}>
                  <Stack gap="sm">
                    <Bone size="title" />
                    <Bone size={BONE_WIDTHS[i % BONE_WIDTHS.length]} />
                    <Bone size="sm" />
                  </Stack>
                </Card>
              ))}
            </Grid>
          )}
        </div>
      )}
    </>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className={styles.error} role="alert">
      <CircleAlert size={18} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/** Toggleable filter pill. */
export function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button type="button" className={`${styles.chip} ${active ? styles.chipActive : ''}`} aria-pressed={active} onClick={onClick}>
      {children}
      {count !== undefined && <span className={styles.chipCount}>{count}</span>}
    </button>
  );
}

export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.chipRow} role="group" aria-label={label}>
      {children}
    </div>
  );
}

interface TabsProps<T extends string> {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}

export function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={`${styles.tab} ${tab.id === active ? styles.tabActive : ''}`}
          // The page-wide fade draws the page over any open dialog, so tabs inside a dialog switch without it.
          onClick={(event) => (event.currentTarget.closest('dialog') ? onChange(tab.id) : withViewTransition(() => onChange(tab.id)))}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && <span className={styles.count}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Auto-fitting grid of cards or tiles. */
export function Grid({ children }: { children: ReactNode }) {
  return <div className={`${styles.gridLayout} ${styles['grid-lg']}`}>{children}</div>;
}

/** Generic list row: leading visual, title/subtitle, trailing content. Becomes a button when onClick is given. */
/**
 * One mono line of counts, like a printed tally. Zero counts recede; non-zero ones take their state colour.
 */
export function Ledger({ entries, label }: { entries: Array<{ label: string; value: ReactNode; tone?: StatusTone; to?: string; active?: boolean }>; label: string }) {
  return (
    <ul className={styles.ledger} aria-label={label}>
      {entries.map((entry) => {
        const cls = `${styles.ledgerEntry} ${entry.active === false ? styles.ledgerIdle : entry.tone ? styles[`text-${entry.tone}`] : ''}`;
        const body = (
          <>
            <span className={styles.ledgerLabel}>{entry.label}</span>
            <span className={styles.ledgerValue}>{entry.value}</span>
          </>
        );
        return (
          <li key={entry.label}>
            {entry.to ? (
              <Link to={entry.to} className={`${cls} ${styles.ledgerLink}`}>
                {body}
              </Link>
            ) : (
              <span className={cls}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Row({ leading, title, subtitle, trailing, onClick, to, flagged }: { leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; onClick?: () => void; to?: string; flagged?: boolean | 'danger' | 'warn' }) {
  const inner = (
    <>
      {leading}
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{title}</span>
        {subtitle && <span className={styles.rowSubtitle}>{subtitle}</span>}
      </span>
      {trailing && <span className={styles.rowTrailing}>{trailing}</span>}
    </>
  );
  const classes = `${styles.row} ${flagged === 'warn' ? styles.rowFlaggedWarn : flagged ? styles.rowFlagged : ''}`;
  if (to) {
    return (
      <Link to={to} className={`${classes} ${styles.rowButton} ${styles.rowLink}`}>
        {inner}
      </Link>
    );
  }
  return onClick ? (
    <button type="button" className={`${classes} ${styles.rowButton}`} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className={classes}>{inner}</div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className={styles.list}>{children}</div>;
}

/** A single fact beside a page title: a mono label over a figure, right-aligned on wide screens. */
export function HeaderStat({ label, value, hint, to, tone }: { label: string; value: ReactNode; hint?: string; to?: string; tone?: StatusTone }) {
  const body = (
    <>
      <span className={styles.headerStatLabel}>{label}</span>
      <span className={`${styles.headerStatValue} ${tone ? styles[`text-${tone}`] : ''}`}>{value}</span>
      {hint && <span className={styles.headerStatHint}>{hint}</span>}
    </>
  );
  return to ? (
    <Link to={to} className={styles.headerStat}>
      {body}
    </Link>
  ) : (
    <span className={styles.headerStat}>{body}</span>
  );
}

/** Row subtitle with a context line above a gauge. */
export function RowDetail({ children, gauge }: { children: ReactNode; gauge?: ReactNode }) {
  return (
    <span className={styles.rowDetail}>
      <span className={styles.rowDetailText}>{children}</span>
      {gauge}
    </span>
  );
}

/** Small mono read-out for summary lines such as "This month · 4 done · 12 h". */
export function Readout({ children }: { children: ReactNode }) {
  return <span className={styles.readout}>{children}</span>;
}

/** Monospaced figure for quantities, hours and money so columns line up. */
export function Figure({ children, tone }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`${styles.figure} ${tone ? styles[`text-${tone}`] : ''}`}>{children}</span>;
}

/** A key or a keyboard shortcut, shown beside the action it belongs to. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

export function Stack({ children, gap = 'md' }: { children: ReactNode; gap?: 'sm' | 'md' | 'lg' }) {
  return <div className={`${styles.stack} ${styles[`gap-${gap}`]}`}>{children}</div>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className={styles.muted}>{children}</span>;
}
