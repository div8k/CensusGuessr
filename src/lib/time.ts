// Development-only clock override for testing the daily rollover:
//   http://localhost:5173/?now=2026-11-20T23:59:45Z
// The clock keeps ticking from the given instant. Ignored in production builds.
let offset = 0;
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const raw = new URLSearchParams(window.location.search).get('now');
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isNaN(parsed)) offset = parsed - Date.now();
}

export const now = (): number => Date.now() + offset;
