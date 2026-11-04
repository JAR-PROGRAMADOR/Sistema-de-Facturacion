import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData, apiPaginated } from '../../shared/api/helpers';

export interface PurchaseSummary {
  id: string;
  supplier_id: string;
  supplier_name: string;
  payment_method_id: string | null;
  payment_method_name: string | null;
  status: 'RECIBIDA' | 'ANULADA';
  subtotal: number;
  tax_total: number;
  total: number;
  currency: string;
  received_at: string;
}

export interface PurchaseInput {
  supplierId: string;
  paymentMethodId?: string | null;
  notes?: string | null;
  items: Array<{ productId: string; quantity: number; unitCost: number }>;
}

export const purchaseKeys = {
  all: ['purchases'] as const,
  list: (companyId: string | null, isPlatform: boolean) => [...purchaseKeys.all, companyId, isPlatform] as const,
};

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}` : '';
}

export function usePurchases(companyId: string | null, isPlatform: boolean) {
  return useQuery({
    queryKey: purchaseKeys.list(companyId, isPlatform),
    queryFn: () => apiPaginated<PurchaseSummary>(`${base(companyId, isPlatform)}/purchases?page=1&limit=100`),
    enabled: !!companyId,
  });
}

export function useCreatePurchase(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PurchaseInput) => apiData(`${base(companyId, isPlatform)}/purchases`, { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.all });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useCancelPurchase(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { purchaseId: string; reason: string }) =>
      apiData<void>(`${base(companyId, isPlatform)}/purchases/${input.purchaseId}/cancel`, { method: 'POST', body: { reason: input.reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.all });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
