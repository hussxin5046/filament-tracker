import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * The last line: an error while a screen draws would otherwise leave the page blank, with no clue why.
 * Shows the message, which is what lets it be fixed, and a way to try again. Plain markup and the
 * global .load-error styles, so it still works when the cause is in the shared components.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="load-error" role="alert">
        <h1>Something went wrong</h1>
        <p>Send this message to whoever looks after Wrkbench:</p>
        <pre>{`${error.message}\n\n${(error.stack ?? '').split('\n').slice(0, 6).join('\n')}\n\n${navigator.userAgent}`}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
