import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData, apiPaginated } from '../../shared/api/helpers';

export interface Supplier {
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

export interface SupplierInput {
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export const suppliersKeys = {
  all: ['suppliers'] as const,
  list: (companyId: string | null, search: string) => [...suppliersKeys.all, 'list', companyId, search] as const,
};

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}/suppliers` : '/suppliers';
}

export function useSuppliers(companyId: string | null, isPlatform: boolean, search: string) {
  const params = new URLSearchParams({ page: '1', limit: '100' });
  if (search.trim()) params.set('search', search.trim());
  return useQuery({
    queryKey: [...suppliersKeys.list(companyId, search), isPlatform],
    queryFn: () => apiPaginated<Supplier>(`${base(companyId, isPlatform)}?${params.toString()}`),
    enabled: !!companyId,
  });
}

export function useCreateSupplier(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierInput) => apiData<Supplier>(base(companyId, isPlatform), { method: 'POST', body: input }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: suppliersKeys.all }); },
  });
}

export function useUpdateSupplier(companyId: string | null, isPlatform: boolean, supplierId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierInput) => apiData<Supplier>(`${base(companyId, isPlatform)}/${supplierId}`, { method: 'PATCH', body: input }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: suppliersKeys.all }); },
  });
}

export function useDeactivateSupplier(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (supplierId: string) => apiData<void>(`${base(companyId, isPlatform)}/${supplierId}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: suppliersKeys.all }); },
  });
}
