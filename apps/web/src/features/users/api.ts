import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData, apiPaginated } from '../../shared/api/helpers';
import type { User } from '../../shared/api/types';

export const usersKeys = {
  all: ['users'] as const,
  list: (companyId: string | null, isPlatform: boolean, page: number, limit: number) =>
    [...usersKeys.all, 'list', companyId, isPlatform, page, limit] as const,
};

export function useUsers(companyId: string | null, isPlatform: boolean, page = 1, limit = 20) {
  return useQuery({
    queryKey: usersKeys.list(companyId, isPlatform, page, limit),
    queryFn: () => {
      const path = isPlatform && companyId
        ? `/platform/companies/${companyId}/users?page=${page}&limit=${limit}`
        : '/users?page=1&limit=20';
      return apiPaginated<User>(path);
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
}

export interface CreateUserInput {
  email: string;
  password: string;
  fullName: string;
  locale?: 'es' | 'en' | 'tr' | 'zh-CN' | 'ja' | 'ko';
  // Opcional y se ignora: un usuario nuevo nace solo con el rol Vendedor.
  roleIds?: string[];
}

export interface UpdateUserInput {
  fullName?: string;
  locale?: 'es' | 'en' | 'tr' | 'zh-CN' | 'ja' | 'ko';
  password?: string;
  status?: 'ACTIVO' | 'INACTIVO';
  roleIds?: string[];
}

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}/users` : '/users';
}

export function useCreateUser(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      apiData<User>(base(companyId, isPlatform), { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.all });
    },
  });
}

export function useUpdateUser(companyId: string | null, isPlatform: boolean, userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserInput) =>
      apiData<User>(`${base(companyId, isPlatform)}/${userId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.all });
    },
  });
}

export function useDeactivateUser(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiData<void>(`${base(companyId, isPlatform)}/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.all });
    },
  });
}
