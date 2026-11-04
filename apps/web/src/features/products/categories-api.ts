import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData, apiPaginated } from '../../shared/api/helpers';

export interface Category {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryInput {
  name: string;
  description?: string | null;
  isActive?: boolean;
}

export const categoryKeys = {
  all: ['categories'] as const,
  list: (companyId: string | null, isPlatform: boolean) => [...categoryKeys.all, companyId, isPlatform] as const,
};

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}` : '';
}

export function useCategories(companyId: string | null, isPlatform: boolean) {
  return useQuery({
    queryKey: categoryKeys.list(companyId, isPlatform),
    queryFn: () => apiPaginated<Category>(`${base(companyId, isPlatform)}/categories?page=1&limit=100`),
    enabled: !!companyId,
  });
}

export function useCreateCategory(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryInput) => apiData<Category>(`${base(companyId, isPlatform)}/categories`, { method: 'POST', body: input }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: categoryKeys.all }); },
  });
}

export function useUpdateCategory(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryInput & { categoryId: string }) => {
      const { categoryId, ...patch } = input;
      return apiData<Category>(`${base(companyId, isPlatform)}/categories/${categoryId}`, { method: 'PATCH', body: patch });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: categoryKeys.all }); },
  });
}

export function useDeleteCategory(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => apiData<void>(`${base(companyId, isPlatform)}/categories/${categoryId}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: categoryKeys.all }); },
  });
}
