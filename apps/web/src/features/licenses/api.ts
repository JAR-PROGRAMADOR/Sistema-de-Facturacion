import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData } from '../../shared/api/helpers';

export type LicenseState = 'PENDIENTE' | 'ACTIVA' | 'VENCIDA' | 'SUSPENDIDA' | 'REVOCADA';

export interface LicenseSummary {
  id: string;
  company_id: string;
  status: LicenseState;
  duration_seconds: number;
  max_users: number | null;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface LicenseStatus {
  company: { active: boolean };
  user: { active: boolean; required: boolean };
}

export interface IssuedLicense {
  id: string;
  key: string;
  durationSeconds: number;
  maxUsers?: number;
}

export const licenseKeys = {
  all: ['licenses'] as const,
  status: (companyId: string | null) => [...licenseKeys.all, 'status', companyId] as const,
  company: (companyId: string | null) => [...licenseKeys.all, 'company', companyId] as const,
  user: (companyId: string | null, userId: string) => [...licenseKeys.all, 'user', companyId, userId] as const,
};

function platformBase(companyId: string | null): string {
  return companyId ? `/platform/companies/${companyId}` : '/platform/companies/invalid';
}

export function useLicenseStatus(companyId: string | null) {
  return useQuery({
    queryKey: licenseKeys.status(companyId),
    queryFn: () => apiData<LicenseStatus>('/license-status'),
    enabled: !!companyId,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useActivateLicense(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => apiData<{ scope: 'company' | 'user' | 'both'; status: 'ACTIVA'; startsAt: string; expiresAt: string }>('/licenses/activate', {
      method: 'POST', body: { key },
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: licenseKeys.status(companyId) }); },
  });
}

export function useCompanyLicenses(companyId: string | null) {
  return useQuery({
    queryKey: licenseKeys.company(companyId),
    queryFn: () => apiData<LicenseSummary[]>(`${platformBase(companyId)}/licenses`),
    enabled: !!companyId,
  });
}

export function useUserLicenses(companyId: string | null, userId: string) {
  return useQuery({
    queryKey: licenseKeys.user(companyId, userId),
    queryFn: () => apiData<LicenseSummary[]>(`${platformBase(companyId)}/users/${userId}/licenses`),
    enabled: !!companyId && !!userId,
  });
}

export function useIssueCompanyLicense(companyId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { durationSeconds: number; maxUsers: number }) =>
      apiData<IssuedLicense>('/platform/licenses', { method: 'POST', body: { ...input, companyId } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: licenseKeys.company(companyId) }); },
  });
}

export function useIssueUserLicense(companyId: string | null, userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { durationSeconds: number }) =>
      apiData<IssuedLicense>('/platform/user-licenses', { method: 'POST', body: { ...input, companyId, userId } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: licenseKeys.user(companyId, userId) }); },
  });
}

export function useIssueRegistrationLicense() {
  return useMutation({
    mutationFn: (input: { durationSeconds: number; maxUsers: number }) =>
      apiData<IssuedLicense>('/platform/registration-licenses', { method: 'POST', body: input }),
  });
}

export function useSetLicenseStatus(companyId: string | null, scope: 'company' | 'user', userId = '') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { licenseId: string; status: 'SUSPENDIDA' | 'REVOCADA' }) => {
      const action = input.status === 'SUSPENDIDA' ? 'suspend' : 'revoke';
      const endpoint = scope === 'company'
        ? `/platform/licenses/${input.licenseId}/${action}`
        : `/platform/user-licenses/${input.licenseId}/${action}`;
      return apiData<void>(endpoint, { method: 'POST' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: licenseKeys.company(companyId) });
      void qc.invalidateQueries({ queryKey: licenseKeys.user(companyId, userId) });
    },
  });
}
