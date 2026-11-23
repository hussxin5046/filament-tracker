import { describe, expect, it } from 'vitest';
import { openModalCount } from '@/lib/dialogs';

/** Stand-ins for dialogs, in a browser that does (or, like Chrome 101, does not) know ":modal". */
function dialog({ modal, inert = false, knowsModal = true }: { modal: boolean; inert?: boolean; knowsModal?: boolean }) {
  return {
    inert,
    getAttribute: (name: string) => (name === 'aria-hidden' && inert ? 'true' : null),
    matches: (selector: string) => {
      if (selector !== ':modal') return false;
      if (!knowsModal) throw new SyntaxError("':modal' is not a valid selector");
      return modal;
    },
  };
}

function withDialogs(dialogs: unknown[], run: () => void) {
  const before = globalThis.document;
  (globalThis as { document?: unknown }).document = { querySelectorAll: () => dialogs };
  try {
    run();
  } finally {
    (globalThis as { document?: unknown }).document = before;
  }
}

describe('counting open modal dialogs', () => {
  it('asks the browser where it knows :modal', () => {
    withDialogs([dialog({ modal: true }), dialog({ modal: false })], () => expect(openModalCount()).toBe(1));
  });

  it('does not throw where the browser does not know :modal, and leaves out a closing copy', () => {
    withDialogs([dialog({ modal: true, knowsModal: false }), dialog({ modal: false, inert: true, knowsModal: false })], () => expect(openModalCount()).toBe(1));
  });
});
