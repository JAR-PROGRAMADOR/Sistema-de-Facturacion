import { useQuery } from '@tanstack/react-query';
import { apiPaginated } from '../../shared/api/helpers';

export interface AuditEntry {
  id: string;
  company_id: string | null;
  user_id: string | null;
  user_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  result: 'OK' | 'ERROR';
  ip: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}` : '';
}

export function useAuditLogs(companyId: string | null, isPlatform: boolean, action: string, result: string) {
  const params = new URLSearchParams({ page: '1', limit: '100' });
  if (action.trim()) params.set('action', action.trim());
  if (result) params.set('result', result);
  return useQuery({
    queryKey: ['audit-logs', companyId, isPlatform, action, result],
    queryFn: () => apiPaginated<AuditEntry>(`${base(companyId, isPlatform)}/audit-logs?${params}`),
    enabled: !!companyId,
  });
}
