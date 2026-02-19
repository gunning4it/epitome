import { describe, expect, it } from 'vitest';
import { normalizeDashboardRedirect } from '@/utils/auth-redirect';

describe('normalizeDashboardRedirect', () => {
  it('defaults to /agents when redirect is missing', () => {
    expect(normalizeDashboardRedirect(undefined)).toBe('/agents');
    expect(normalizeDashboardRedirect('')).toBe('/agents');
  });

  it('maps legacy /profile redirects to /agents', () => {
    expect(normalizeDashboardRedirect('/profile')).toBe('/agents');
    expect(normalizeDashboardRedirect('/profile/')).toBe('/agents');
    expect(normalizeDashboardRedirect('/profile?tab=settings')).toBe('/agents');
  });

  it('keeps non-profile redirects unchanged', () => {
    expect(normalizeDashboardRedirect('/agents')).toBe('/agents');
    expect(normalizeDashboardRedirect('/tables')).toBe('/tables');
    expect(normalizeDashboardRedirect('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(
      'https://chatgpt.com/connector_platform_oauth_redirect'
    );
  });
});
