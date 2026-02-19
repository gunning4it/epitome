/**
 * Normalizes post-login redirect targets for dashboard sign-in.
 *
 * Legacy clients sometimes request /profile after OAuth. We now treat that
 * as /agents so all dashboard logins land on the new default page.
 */
export function normalizeDashboardRedirect(redirectUri?: string): string {
  const redirect = redirectUri?.trim();
  if (!redirect) return '/agents';

  const isLegacyProfileRedirect = /^\/profile(?:[/?#]|$)/.test(redirect);
  if (isLegacyProfileRedirect) return '/agents';

  return redirect;
}
