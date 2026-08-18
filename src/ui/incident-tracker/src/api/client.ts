import { authApi, getApiBaseUrl, ensureTokenFresh } from '@core';

function authHeaders(): Record<string, string> {
  const token = authApi.getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

/**
 * Structured view of a backend error. The API returns `{ code, message,
 * field? }` (see odo's ApiError), and the client throws it as `new Error(body)`
 * with that JSON as the message. `parseApiError` turns any caught error back
 * into this shape so callers can act on `field`/`code` instead of string-
 * matching the message. `field` is present only on field-level conflicts.
 */
export interface ApiErrorInfo {
  code?: string;
  field?: string;
  message: string;
}

export function parseApiError(err: unknown): ApiErrorInfo {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        code: typeof parsed.code === 'string' ? parsed.code : undefined,
        field: typeof parsed.field === 'string' ? parsed.field : undefined,
        message: typeof parsed.message === 'string' ? parsed.message : raw,
      };
    }
  } catch {
    // not JSON — fall through to the raw string
  }
  return { message: raw };
}

async function throwResponseError(response: Response): Promise<never> {
  const body = await response.text().catch(() => '');
  if (response.status === 401) {
    authApi.sessionExpired$.next();
  }
  throw new Error(body || `Request failed: ${response.status}`);
}

export async function currentGet<T>(path: string): Promise<T> {
  await ensureTokenFresh();

  const response = await fetch(`${getApiBaseUrl()}/api/v1/current${path}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }

  return response.json();
}

export async function currentPost<T>(path: string, body?: Record<string, any>): Promise<T> {
  return odoServicePost<T>('/api/v1/current', path, body);
}

/**
 * POST to an `odo-notify` REST endpoint, e.g.
 *   notifyPost('/inbox/list', { limit: 50, offset: 0 })
 * Mirrors `currentPost` shape; the only difference is the service
 * prefix. Used by `notificationsApi` to talk to odo-notify directly
 * over HTTP instead of the legacy WebSocket route.
 */
export async function notifyPost<T>(path: string, body?: Record<string, any>): Promise<T> {
  return odoServicePost<T>('/api/v1/odo/notify', path, body);
}

async function odoServicePost<T>(
  servicePrefix: string,
  path: string,
  body?: Record<string, any>,
): Promise<T> {
  await ensureTokenFresh();

  const response = await fetch(`${getApiBaseUrl()}${servicePrefix}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    await throwResponseError(response);
  }

  return response.json();
}
