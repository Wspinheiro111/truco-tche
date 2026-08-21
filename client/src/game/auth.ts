export function exposeLegacyAuthState(): void {
  window.AUTH ??= { user: null, session: null };
  window.localUser ??= null;
}

declare global {
  interface Window {
    AUTH?: { user: unknown; session: unknown };
    localUser?: unknown;
  }
}
