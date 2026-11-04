import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData, apiPaginated } from '../../shared/api/helpers';

export interface Product {
  id: string;
  companyId: string;
  categoryId: string | null;
  taxRateId: string | null;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  type: 'BIEN' | 'SERVICIO';
  price: number;
  cost: number | null;
  trackStock: boolean;
  minStock: number;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  product_id: string;
  sku: string;
  name: string;
  category_id: string | null;
  quantity: number;
  min_stock: number;
  track_stock: boolean;
  is_active: boolean;
  category_name: string | null;
}

export interface ProductInput {
  categoryId?: string | null;
  taxRateId?: string | null;
  sku: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  type?: 'BIEN' | 'SERVICIO';
  price: number;
  cost?: number | null;
  trackStock?: boolean;
  minStock?: number;
  isActive?: boolean;
  initialStock?: number;
}

export const productsKeys = {
  all: ['products'] as const,
  list: (companyId: string | null) => [...productsKeys.all, 'list', companyId] as const,
  inventory: (companyId: string | null) => [...productsKeys.all, 'inventory', companyId] as const,
};

function productBase(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}/products` : '/products';
}

export function useProducts(companyId: string | null, isPlatform = false) {
  return useQuery({
    queryKey: [...productsKeys.list(companyId), isPlatform],
    queryFn: () => apiPaginated<Product>(`${productBase(companyId, isPlatform)}?page=1&limit=100`),
    enabled: !!companyId,
  });
}

export function useCreateProduct(companyId: string | null, isPlatform = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) => apiData<Product>(productBase(companyId, isPlatform), { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productsKeys.list(companyId) });
      void qc.invalidateQueries({ queryKey: productsKeys.inventory(companyId) });
    },
  });
}

function inventoryBase(companyId: string | null, isPlatform: boolean): string {
  return isPlatform && companyId ? `/platform/companies/${companyId}/inventory` : '/inventory';
}

export function useInventory(companyId: string | null, isPlatform = false) {
  return useQuery({
    queryKey: [...productsKeys.inventory(companyId), isPlatform],
    queryFn: () => apiPaginated<InventoryItem>(`${inventoryBase(companyId, isPlatform)}?page=1&limit=100`),
    enabled: !!companyId,
  });
}

export function useAdjustStock(companyId: string | null, isPlatform = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { productId: string; quantity: number; type: 'ENTRADA' | 'SALIDA' | 'AJUSTE'; reason?: string | null }) =>
      apiData<{ productId: string; quantity: number; type: 'ENTRADA' | 'SALIDA' | 'AJUSTE'; stockAfter: number }>(`${inventoryBase(companyId, isPlatform)}/adjust`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productsKeys.inventory(companyId) });
      void qc.invalidateQueries({ queryKey: productsKeys.list(companyId) });
    },
  });
}
