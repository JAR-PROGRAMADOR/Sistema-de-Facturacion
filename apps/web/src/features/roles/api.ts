import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData } from '../../shared/api/helpers';
import type { Permission, Role } from '../../shared/api/types';

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId
    ? `/platform/companies/${companyId}/roles`
    : '/roles';
}

export const rolesKeys = {
  all: ['roles'] as const,
  list: (companyId: string | null) => [...rolesKeys.all, 'list', companyId] as const,
  permissions: () => ['permissions'] as const,
};

export function usePermissions() {
  return useQuery({
    queryKey: rolesKeys.permissions(),
    queryFn: () => apiData<Permission[]>('/permissions'),
    staleTime: 5 * 60_000,
  });
}

export function useRoles(companyId: string | null, isPlatform: boolean) {
  return useQuery({
    queryKey: rolesKeys.list(companyId),
    queryFn: () => apiData<Role[]>(base(companyId, isPlatform)),
    enabled: !!companyId,
  });
}

export interface CreateRoleInput {
  name: string;
  description?: string | null;
  permissionCodes?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
}

export function useCreateRole(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoleInput) =>
      apiData<Role>(base(companyId, isPlatform), { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rolesKeys.all });
    },
  });
}

export function useUpdateRole(companyId: string | null, isPlatform: boolean, roleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRoleInput) =>
      apiData<Role>(`${base(companyId, isPlatform)}/${roleId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rolesKeys.all });
    },
  });
}

export function useDeleteRole(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) =>
      apiData<void>(`${base(companyId, isPlatform)}/${roleId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rolesKeys.all });
    },
  });
}

export function useSetRolePermissions(
  companyId: string | null,
  isPlatform: boolean,
  roleId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (permissionCodes: string[]) =>
      apiData<Role>(`${base(companyId, isPlatform)}/${roleId}/permissions`, {
        method: 'PUT',
        body: { permissionCodes },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rolesKeys.all });
    },
  });
}