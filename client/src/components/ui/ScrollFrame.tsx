import { useCallback, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import styles from '@/components/ui/ScrollFrame.module.css';

interface ScrollFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onScroll'> {
  children: ReactNode;
  /** Class for the sideways scroller itself (the frame around it only holds the buttons). */
  scrollerClassName?: string;
  /** Gives the caller the scroller element, for measuring it. */
  scrollerRef?: Ref<HTMLDivElement>;
  /** `item`: one child at a time, for boards of columns. `page`: most of the width, for chips and tabs. */
  step?: 'item' | 'page';
  /** Anything that changes what is inside, so the buttons are worked out again. */
  watch?: unknown;
}

/**
 * Every sideways scroller in the app goes through this: the same round arrow buttons at the edges, shown only
 * while there is more to see that way, moving smoothly (or at once for anyone who asked for less motion).
 */
export function ScrollFrame({ children, scrollerClassName, scrollerRef, step = 'page', watch, className, ...rest }: ScrollFrameProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [reach, setReach] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const left = element.scrollLeft > 4;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 4;
    setReach((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);

  useLayoutEffect(() => {
    update();
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [update, watch]);

  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      scroller.current = element;
      if (typeof scrollerRef === 'function') scrollerRef(element);
      else if (scrollerRef) scrollerRef.current = element;
    },
    [scrollerRef],
  );

  const nudge = (direction: -1 | 1) => {
    const element = scroller.current;
    if (!element) return;
    const first = element.firstElementChild;
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
    const distance = step === 'item' && first ? first.getBoundingClientRect().width + gap : element.clientWidth * 0.8;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    element.scrollBy({ left: direction * distance, behavior });
  };

  return (
    <div className={`${styles.frame} ${className ?? ''}`}>
      <IconButton icon={ChevronLeft} label="Scroll left" className={`${styles.nudge} ${styles.left} ${reach.left ? styles.shown : ''}`} tabIndex={reach.left ? 0 : -1} aria-hidden={!reach.left} onClick={() => nudge(-1)} />
      <IconButton icon={ChevronRight} label="Scroll right" className={`${styles.nudge} ${styles.right} ${reach.right ? styles.shown : ''}`} tabIndex={reach.right ? 0 : -1} aria-hidden={!reach.right} onClick={() => nudge(1)} />
      <div ref={setRefs} className={`${styles.scroller} ${scrollerClassName ?? ''}`} onScroll={update} {...rest}>
        {children}
      </div>
    </div>
  );
}
