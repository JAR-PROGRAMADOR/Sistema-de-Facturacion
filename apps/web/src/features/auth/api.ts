import { apiFetch } from '../../shared/api/client';

export function requestPasswordReset(email: string): Promise<void> {
  return apiFetch<void>('/auth/password-reset/request', {
    method: 'POST',
    body: { email },
    skipAuth: true,
  });
}

export function confirmPasswordReset(token: string, password: string): Promise<void> {
  return apiFetch<void>('/auth/password-reset/confirm', {
    method: 'POST',
    body: { token, password },
    skipAuth: true,
  });
}