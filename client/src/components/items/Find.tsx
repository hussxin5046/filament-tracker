import { useEffect, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import type { FindAnswer, Item } from '@/lib/types';
import styles from '@/components/items/Items.module.css';

const names = (displays: FindAnswer['displays']) => displays.map((display) => display.name).join(' and ');

/** What a find came back with, in a sentence. `left` is the seconds the display stays lit. */
export function describeFind(found: FindAnswer, left: number): string {
  const where = found.place ? ` It is in ${found.place}.` : '';
  switch (found.state) {
    case 'lit': {
      const showing = found.displays.filter((display) => display.online && !display.outdated);
      if (!showing.length) return `${names(found.displays)} needs a firmware update before it can light up.${where}`;
      return `Lit up on ${names(showing)} for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.${where}`;
    }
    case 'offline':
      return `${names(found.displays)} is not connected, so it cannot light up.${where}`;
    case 'no-display':
      return `No display shows where it is kept.${where}`;
    case 'loaded':
      return `It is loaded in ${found.place}.`;
    case 'on-the-move':
      return 'It is on the move: someone took it out.';
    default:
      return 'It has no location.';
  }
}

/**
 * Looking for an item and taking it out, for the item's sheet and for handheld mode. **Where is it?** asks where it is
 * and lights the location display nearest to it; **Take out** marks it on the move.
 */
export function useFind(item: Item) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const [found, setFound] = useState<FindAnswer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Kept in a location and not loaded: only then can it be taken out. */
  const kept = item.locationId !== null && !item.slot;
  const findPath = wsPath(`/items/${item.id}/find`)!;

  const find = () =>
    run(async () => {
      setFound(await api.post<FindAnswer>(findPath));
      setNow(Date.now());
    });
  const stop = () => {
    setFound(null);
    return run(() => api.delete(findPath));
  };
  const takeOut = async () => {
    if (await run(() => api.post(wsPath(`/items/${item.id}/take-out`)!), 'On the move. Press Load into… at the printer.')) setFound(null);
  };

  // A scan can swap the screen to another item: what was said about the last one does not apply.
  useEffect(() => setFound(null), [item.id]);
  const lighting = found?.expiresAt ?? null;
  useEffect(() => {
    if (lighting === null) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [lighting]);
  // The display stops by itself after two minutes, and when the item leaves its place (taken out at the display, say).
  useEffect(() => {
    if (found && ((lighting !== null && now >= lighting) || (!kept && (lighting !== null || found.state === 'no-display')))) setFound(null);
  }, [found, lighting, now, kept]);

  return { found, busy, kept, find, stop, takeOut, left: lighting === null ? null : Math.max(0, Math.ceil((lighting - now) / 1000)) };
}

/** Where the item is and which display is lit for it, with a way to stop. Nothing until Where is it? was pressed. */
export function FindNote({ finder }: { finder: ReturnType<typeof useFind> }) {
  const { found, left } = finder;
  if (!found) return null;
  return (
    <div className={styles.find} role="status">
      <LocateFixed size={20} aria-hidden />
      <span className={styles.findText}>{describeFind(found, left ?? 0)}</span>
      {left !== null && (
        <Button size="sm" onClick={() => void finder.stop()} disabled={finder.busy}>
          Stop
        </Button>
      )}
    </div>
  );
}
