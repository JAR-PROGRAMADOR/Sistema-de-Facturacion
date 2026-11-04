import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiData, apiPaginated } from '../../shared/api/helpers';

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  is_active?: boolean;
}

export interface SaleItemInput {
  productId: string;
  quantity: number;
  discount: number;
}

export interface CreateSaleInput {
  customerId?: string | null;
  cashSessionId?: string | null;
  paymentMethodId: string;
  paymentReference?: string | null;
  items: SaleItemInput[];
}

export interface SaleSummary {
  id: string;
  customer_id: string | null;
  user_id: string;
  status: 'COMPLETADA' | 'CANCELADA';
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  currency: string;
  sold_at: string;
}

export interface CreatedSale {
  id: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  currency: string;
}

export interface InvoiceSummary {
  id: string;
  sale_id: string;
  full_number: string;
  customer_name: string | null;
  status: 'EMITIDA' | 'ANULADA';
  total: number;
  currency: string;
  issued_at: string;
}

export interface InvoiceDocument extends InvoiceSummary {
  company_id: string;
  sale_id: string;
  series_id: string;
  number: number;
  customer_id: string | null;
  customer_tax_id: string | null;
  customer_address: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  company_name: string;
  company_legal_name: string | null;
  company_tax_id: string | null;
  company_country: string | null;
  items: Array<{
    id: string;
    product_id: string | null;
    description: string;
    quantity: number;
    unit_price: number;
    discount: number;
    tax_rate: number;
    tax_amount: number;
    line_total: number;
  }>;
}

export const salesKeys = {
  all: ['sales'] as const,
  list: (companyId: string | null, isPlatform: boolean) => [...salesKeys.all, 'list', companyId, isPlatform] as const,
  paymentMethods: (companyId: string | null, isPlatform: boolean) => ['payment-methods', companyId, isPlatform] as const,
  invoices: (companyId: string | null, isPlatform: boolean) => ['invoices', companyId, isPlatform] as const,
};

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}` : '';
}

export function useActivePaymentMethods(companyId: string, isPlatform: boolean) {
  return useQuery({
    queryKey: ['payment-methods', 'active', companyId, isPlatform],
    queryFn: async () => {
      const basePath = isPlatform
        ? `/platform/companies/${companyId}`
        : '';
      const all = await apiData<PaymentMethod[]>(`${basePath}/payment-methods`);
      return all.filter((pm) => pm.is_active);
    },
    enabled: !!companyId,
  });
}

export function useSales(companyId: string | null, isPlatform: boolean) {
  return useQuery({
    queryKey: salesKeys.list(companyId, isPlatform),
    queryFn: () => apiPaginated<SaleSummary>(`${base(companyId, isPlatform)}/sales?page=1&limit=20`),
    enabled: !!companyId,
  });
}

export function useCreateSale(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSaleInput) => apiData<CreatedSale>(`${base(companyId, isPlatform)}/sales`, { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesKeys.list(companyId, isPlatform) });
    },
  });
}

export function useInvoices(companyId: string | null, isPlatform: boolean) {
  return useQuery({
    queryKey: salesKeys.invoices(companyId, isPlatform),
    queryFn: () => apiPaginated<InvoiceSummary>(`${base(companyId, isPlatform)}/invoices?page=1&limit=100`),
    enabled: !!companyId,
  });
}

export function useInvoice(companyId: string | null, isPlatform: boolean, invoiceId: string | null) {
  return useQuery({
    queryKey: ['invoice', companyId, isPlatform, invoiceId],
    queryFn: () => apiData<InvoiceDocument>(`${base(companyId, isPlatform)}/invoices/${invoiceId}`),
    enabled: !!companyId && !!invoiceId,
  });
}

export function useIssueInvoice(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saleId: string) => apiData<InvoiceSummary>(`${base(companyId, isPlatform)}/sales/${saleId}/invoice`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesKeys.invoices(companyId, isPlatform) });
      void qc.invalidateQueries({ queryKey: salesKeys.list(companyId, isPlatform) });
    },
  });
}

export function useCancelInvoice(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { invoiceId: string; reason: string }) =>
      apiData<void>(`${base(companyId, isPlatform)}/invoices/${input.invoiceId}/cancel`, {
        method: 'POST', body: { reason: input.reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesKeys.invoices(companyId, isPlatform) });
      void qc.invalidateQueries({ queryKey: salesKeys.list(companyId, isPlatform) });
    },
  });
}

export function useCancelSale(companyId: string | null, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { saleId: string; reason: string; refundReference?: string | null }) =>
      apiData<void>(`${base(companyId, isPlatform)}/sales/${input.saleId}/cancel`, {
        method: 'POST', body: { reason: input.reason, refundReference: input.refundReference ?? null },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesKeys.list(companyId, isPlatform) });
      void qc.invalidateQueries({ queryKey: salesKeys.invoices(companyId, isPlatform) });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['cash'] });
    },
  });
}