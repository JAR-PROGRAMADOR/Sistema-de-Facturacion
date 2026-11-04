import { useQuery } from '@tanstack/react-query';
import { apiData } from '../../shared/api/helpers';

export interface SalesSummary {
  from: string;
  to: string;
  salesCount: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  daily: Array<{ day: string; salesCount: number; total: number }>;
}

export interface TopProduct {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  revenue: number;
}

export interface LowStockProduct {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  minStock: number;
}

function base(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}` : '';
}

export function useSalesSummary(companyId: string | null, isPlatform: boolean, from: string, to: string) {
  const params = new URLSearchParams({ from, to });
  return useQuery({
    queryKey: ['reports', 'sales', companyId, isPlatform, from, to],
    queryFn: () => apiData<SalesSummary>(`${base(companyId, isPlatform)}/reports/sales-summary?${params}`),
    enabled: !!companyId,
  });
}

export function useTopProducts(companyId: string | null, isPlatform: boolean, from: string, to: string) {
  const params = new URLSearchParams({ from, to, limit: '10' });
  return useQuery({
    queryKey: ['reports', 'top-products', companyId, isPlatform, from, to],
    queryFn: () => apiData<TopProduct[]>(`${base(companyId, isPlatform)}/reports/top-products?${params}`),
    enabled: !!companyId,
  });
}

export function useLowStock(companyId: string | null, isPlatform: boolean) {
  return useQuery({
    queryKey: ['reports', 'low-stock', companyId, isPlatform],
    queryFn: () => apiData<LowStockProduct[]>(`${base(companyId, isPlatform)}/reports/low-stock`),
    enabled: !!companyId,
  });
}
