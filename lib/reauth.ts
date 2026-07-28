export const REAUTH_FRESHNESS_MINUTES = 5;

export function isSessionFresh(lastSignInAt: string | null | undefined): boolean {
  if (!lastSignInAt) return false;
  const ageMs = Date.now() - new Date(lastSignInAt).getTime();
  return ageMs < REAUTH_FRESHNESS_MINUTES * 60 * 1000;
}
