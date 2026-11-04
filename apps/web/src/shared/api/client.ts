import { ApiError } from './error';

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

type TokenGetter = () => string | null;
type TokenSetter = (token: string | null) => void;
type UnauthorizedHandler = () => void;

let getAccessToken: TokenGetter = () => null;
let setAccessToken: TokenSetter = () => {};
let onUnauthorized: UnauthorizedHandler = () => {};

export function configureApiClient(opts: {
  getAccessToken: TokenGetter;
  setAccessToken: TokenSetter;
  onUnauthorized: UnauthorizedHandler;
}): void {
  getAccessToken = opts.getAccessToken;
  setAccessToken = opts.setAccessToken;
  onUnauthorized = opts.onUnauthorized;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* body no es JSON */
  }

  const readString = (obj: unknown, key: string): string | null => {
    if (obj && typeof obj === 'object' && key in obj) {
      const v = (obj as Record<string, unknown>)[key];
      if (typeof v === 'string') return v;
    }
    return null;
  };

  const nestedError =
    body && typeof body === 'object' && 'error' in body
      ? (body as Record<string, unknown>).error
      : null;

  const message =
    readString(nestedError, 'message') ??
    readString(body, 'message') ??
    readString(body, 'error') ??
    res.statusText ??
    'Error desconocido';

  const code =
    readString(nestedError, 'code') ??
    readString(body, 'code') ??
    `HTTP_${res.status}`;

  return new ApiError(code, message, res.status, body);
}

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) return false;

  try {
    const body = (await res.json()) as {
      data?: { accessToken?: string };
      accessToken?: string;
    };
    const token = body.data?.accessToken ?? body.accessToken;
    if (typeof token === 'string' && token.length > 0) {
      setAccessToken(token);
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  skipAuth?: boolean;
  raw?: boolean;
}

function buildHeaders(
  init: RequestInit,
  body: unknown,
  skipAuth: boolean,
): Headers {
  const h = new Headers(init.headers);
  if (
    body !== undefined &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams) &&
    !h.has('Content-Type')
  ) {
    h.set('Content-Type', 'application/json');
  }
  if (!skipAuth) {
    const token = getAccessToken();
    if (token) h.set('Authorization', `Bearer ${token}`);
  }
  return h;
}

function encodeBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (body instanceof FormData) return body;
  if (body instanceof URLSearchParams) return body;
  if (typeof body === 'string') return body;
  if (body instanceof Blob) return body;
  return JSON.stringify(body);
}

export async function apiFetch<T>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const { body, skipAuth = false, raw = false, ...rest } = opts;
  const url = `${API_URL}${path}`;

  let res = await fetch(url, {
    ...rest,
    headers: buildHeaders(rest, body, skipAuth),
    body: encodeBody(body),
    credentials: 'include',
  });

  if (res.status === 401 && !skipAuth && path !== '/auth/refresh') {
    refreshInFlight ??= doRefresh().finally(() => {
      refreshInFlight = null;
    });
    const ok = await refreshInFlight;

    if (ok) {
      res = await fetch(url, {
        ...rest,
        headers: buildHeaders(rest, body, skipAuth),
        body: encodeBody(body),
        credentials: 'include',
      });
    } else {
      onUnauthorized();
      throw new ApiError('UNAUTHORIZED', 'Tu sesión ha expirado.', 401, null);
    }
  }

  if (!res.ok) throw await parseError(res);
  if (raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { API_URL };