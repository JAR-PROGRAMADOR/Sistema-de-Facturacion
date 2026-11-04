import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData, apiPaginated } from '../../shared/api/helpers';
import type { Company } from '../../shared/api/types';

export const companiesKeys = {
  all: ['companies'] as const,
  list: (page: number, limit: number) => [...companiesKeys.all, 'list', page, limit] as const,
};

export function useCompanies(page = 1, limit = 20) {
  return useQuery({
    queryKey: companiesKeys.list(page, limit),
    queryFn: () => apiPaginated<Company>(`/platform/companies?page=${page}&limit=${limit}`),
    staleTime: 30_000,
  });
}

export interface CompanyCreateInput {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  country?: string | null;
  currency: string;
  locale: string;
  timezone: string;
}

export interface CompanyUpdateInput {
  name?: string;
  legalName?: string | null;
  taxId?: string | null;
  country?: string | null;
  currency?: string;
  locale?: string;
  timezone?: string;
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyCreateInput) =>
      apiData<Company>('/platform/companies', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: companiesKeys.all });
    },
  });
}

export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CompanyUpdateInput }) =>
      apiData<Company>(`/platform/companies/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: companiesKeys.all });
    },
  });
}

export function useSetCompanyStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVA' | 'SUSPENDIDA' }) =>
      apiData<Company>(`/platform/companies/${id}/${status === 'ACTIVA' ? 'activate' : 'suspend'}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: companiesKeys.all });
    },
  });
}
