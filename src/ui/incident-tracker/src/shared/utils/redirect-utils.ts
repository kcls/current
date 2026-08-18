import { APP_BASENAME, ROUTES } from '../../constants';

export function getRedirectPath(pathname: string, search: string): string | undefined {
  // When basename is "/", treat it as empty so we don't slice off the path's leading "/"
  const basename = APP_BASENAME === '/' ? '' : APP_BASENAME;
  const stripped = pathname.startsWith(basename) ? pathname.slice(basename.length) : pathname;
  const returnPath = (stripped || '/') + search;
  return (returnPath !== '/' && returnPath !== ROUTES.LOGIN) ? returnPath : undefined;
}

export function routeToHref(
  route: string,
  baseUrl: string = import.meta.env.BASE_URL,
): string {
  return baseUrl.replace(/\/+$/, '') + '/' + route.replace(/^\/+/, '');
}
