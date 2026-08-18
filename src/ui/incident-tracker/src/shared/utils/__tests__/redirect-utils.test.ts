import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { routeToHref } from '../redirect-utils';

describe('getRedirectPath', () => {
  describe('when APP_BASENAME is "/incident-tracker" (subpath mount)', () => {
    let getRedirectPath: (pathname: string, search: string) => string | undefined;

    beforeAll(async () => {
      vi.resetModules();
      vi.doMock('../../../constants', () => ({
        APP_BASENAME: '/incident-tracker',
        ROUTES: { LOGIN: '/login' },
      }));
      ({ getRedirectPath } = await import('../redirect-utils'));
    });

    afterAll(() => {
      vi.doUnmock('../../../constants');
      vi.resetModules();
    });

    it('should strip the basename and return the in-app path', () => {
      expect(getRedirectPath('/incident-tracker/incidents/42', '')).toBe('/incidents/42');
    });

    it('should preserve the query string', () => {
      expect(getRedirectPath('/incident-tracker/incidents', '?status=open')).toBe('/incidents?status=open');
    });

    it.each([
      '/incident-tracker',
      '/incident-tracker/',
      '/',
    ])('should return undefined for root path %s', (pathname) => {
      expect(getRedirectPath(pathname, '')).toBeUndefined();
    });

    it.each([
      '/incident-tracker/login',
      '/login',
    ])('should return undefined for login path %s', (pathname) => {
      expect(getRedirectPath(pathname, '')).toBeUndefined();
    });
  });

  describe('when APP_BASENAME is "/" (root mount)', () => {
    let getRedirectPath: (pathname: string, search: string) => string | undefined;

    beforeAll(async () => {
      vi.resetModules();
      vi.doMock('../../../constants', () => ({
        APP_BASENAME: '/',
        ROUTES: { LOGIN: '/login' },
      }));
      ({ getRedirectPath } = await import('../redirect-utils'));
    });

    afterAll(() => {
      vi.doUnmock('../../../constants');
      vi.resetModules();
    });

    // Regression: slice(1) used to eat the leading "/", breaking post-SSO redirect.
    it.each([
      '/patrons/442',
      '/incidents/42',
    ])('should preserve the leading "/" in the returned path: %s', (path) => {
      expect(getRedirectPath(path, '')).toBe(path);
    });

    it('should preserve the query string', () => {
      expect(getRedirectPath('/incidents', '?status=open')).toBe('/incidents?status=open');
    });

    it('should return undefined for root path', () => {
      expect(getRedirectPath('/', '')).toBeUndefined();
    });

    it('should return undefined for login path', () => {
      expect(getRedirectPath('/login', '')).toBeUndefined();
    });
  });
});

describe('routeToHref', () => {
  it.each([
    ['/login', '/incident-tracker/', '/incident-tracker/login'],
    ['/login', '/incident-tracker',  '/incident-tracker/login'],
    ['/login', '/',                  '/login'],
    ['login',  '/incident-tracker/', '/incident-tracker/login'],
    ['login',  '/incident-tracker',  '/incident-tracker/login'],
    ['login',  '/',                  '/login'],
  ])('should join route "%s" with baseUrl "%s" to produce "%s"', (route, baseUrl, expected) => {
    expect(routeToHref(route, baseUrl)).toBe(expected);
  });
});
