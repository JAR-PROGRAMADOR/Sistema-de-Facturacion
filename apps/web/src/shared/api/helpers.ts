import { apiFetch, type ApiFetchOptions } from './client';

/** GET/POST/PATCH con envoltura { data: T }. */
export async function apiData<T>(path: string, opts?: ApiFetchOptions): Promise<T> {
  const res = await apiFetch<{ data: T }>(path, opts);
  return res.data;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** GET de listados: { data: T[], meta: { total, page, limit } }. */
export async function apiPaginated<T>(
  path: string,
  opts?: ApiFetchOptions,
): Promise<Paginated<T>> {
  const res = await apiFetch<{
    data: T[];
    meta: { total: number; page: number; limit: number };
  }>(path, opts);
  return { items: res.data, ...res.meta };
}