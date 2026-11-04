import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData, apiPaginated } from '../../shared/api/helpers';

export interface Customer {
  id: string;
  company_id: string;
  name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerInput {
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export const customersKeys = {
  all: ['customers'] as const,
  list: (companyId: string | null, search: string) => [...customersKeys.all, 'list', companyId, search] as const,
};

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}/customers` : '/customers';
}

export function useCustomers(companyId: string | null, isPlatform: boolean, search: string) {
  const params = new URLSearchParams({ page: '1', limit: '100' });
  if (search.trim()) params.set('search', search.trim());
  return useQuery({
    queryKey: [...customersKeys.list(companyId, search), isPlatform],
    queryFn: () => apiPaginated<Customer>(`${base(companyId, isPlatform)}?${params.toString()}`),
    enabled: !!companyId,
  });
}

export function useCreateCustomer(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) => apiData<Customer>(base(companyId, isPlatform), { method: 'POST', body: input }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: customersKeys.all }); },
  });
}

export function useUpdateCustomer(companyId: string | null, isPlatform: boolean, customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) => apiData<Customer>(`${base(companyId, isPlatform)}/${customerId}`, { method: 'PATCH', body: input }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: customersKeys.all }); },
  });
}

export function useDeactivateCustomer(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (customerId: string) => apiData<void>(`${base(companyId, isPlatform)}/${customerId}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: customersKeys.all }); },
  });
}
