/**
 * How many modal dialogs are open. ":modal" would say it in one selector, but Chrome only knows it from version
 * 105, and older ones throw on it, which is what a Zebra TC56 with Chrome 101 did. So: every open dialog, minus
 * the inert copies a closing dialog leaves behind while it fades (see Modal), asking ":modal" only where the
 * browser understands it.
 */
export function openModalCount(): number {
  let count = 0;
  for (const dialog of document.querySelectorAll('dialog[open]')) {
    if (modal(dialog)) count += 1;
  }
  return count;
}

function modal(dialog: Element): boolean {
  try {
    return dialog.matches(':modal');
  } catch {
    return (dialog as HTMLElement).inert !== true && dialog.getAttribute('aria-hidden') !== 'true';
  }
}
