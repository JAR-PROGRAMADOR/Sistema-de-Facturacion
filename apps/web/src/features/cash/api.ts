import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData } from '../../shared/api/helpers';

export interface CashSession {
  id: string;
  company_id: string;
  opened_by: string;
  opened_at: string;
  opening_amount: number;
  closed_by: string | null;
  closed_at: string | null;
  closing_amount_declared: number | null;
  closing_amount_expected: number | null;
  status: 'ABIERTA' | 'CERRADA';
}

export const cashKeys = {
  all: ['cash'] as const,
  current: (companyId: string | null, isPlatform: boolean) => [...cashKeys.all, 'current', companyId, isPlatform] as const,
};

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}` : '';
}

export function useOpenCashSession(companyId: string | null, isPlatform: boolean) {
  return useQuery({
    queryKey: cashKeys.current(companyId, isPlatform),
    queryFn: () => apiData<CashSession | null>(`${base(companyId, isPlatform)}/cash-sessions/open`),
    enabled: !!companyId,
  });
}

export function useOpenCash(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (openingAmount: number) => apiData<CashSession>(`${base(companyId, isPlatform)}/cash-sessions`, {
      method: 'POST', body: { openingAmount },
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: cashKeys.all }); },
  });
}

export function useCloseCash(companyId: string | null, isPlatform: boolean, sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (closingAmountDeclared: number) => apiData<CashSession>(`${base(companyId, isPlatform)}/cash-sessions/${sessionId}/close`, {
      method: 'POST', body: { closingAmountDeclared },
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: cashKeys.all }); },
  });
}

export function useCashMovement(companyId: string | null, isPlatform: boolean, sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: 'INGRESO' | 'EGRESO'; amount: number; reason: string }) =>
      apiData(`${base(companyId, isPlatform)}/cash-sessions/${sessionId}/movements`, { method: 'POST', body: input }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: cashKeys.all }); },
  });
}
