import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiData } from '../../shared/api/helpers';

export interface CompanySettings {
  companyId: string;
  data: Record<string, unknown>;
}

export interface TaxRate {
  id: string;
  company_id: string;
  name: string;
  rate: number;
  is_default: boolean;
  is_active: boolean;
}

export interface PaymentMethod {
  id: string;
  company_id: string;
  code: string;
  name: string;
  is_active: boolean;
}

function base(companyId: string, isPlatform: boolean): string {
  return isPlatform
    ? `/platform/companies/${companyId}`
    : ''; 
}

export const settingsKeys = {
  all: ['settings'] as const,
  taxRates: (companyId: string) => [...settingsKeys.all, 'taxRates', companyId] as const,
  paymentMethods: (companyId: string, isPlatform: boolean) =>
    [...settingsKeys.all, 'paymentMethods', companyId, isPlatform] as const,
};

// -------------------------- Tax rates --------------------------
export function useTaxRates(companyId: string, isPlatform: boolean) {
  return useQuery({
    queryKey: settingsKeys.taxRates(companyId),
    queryFn: () => apiData<TaxRate[]>(`${base(companyId, isPlatform)}/tax-rates`),
    enabled: !!companyId,
  });
}

export interface CreateTaxRateInput {
  name: string;
  rate: number;
  isDefault?: boolean;
}

export interface UpdateTaxRateInput {
  name?: string;
  rate?: number;
  isDefault?: boolean;
  isActive?: boolean;
}

export function useCreateTaxRate(companyId: string, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaxRateInput) =>
      apiData<TaxRate>(`${base(companyId, isPlatform)}/tax-rates`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...settingsKeys.all, 'taxRates'] });
    },
  });
}

export function useUpdateTaxRate(companyId: string, isPlatform: boolean, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTaxRateInput) =>
      apiData<TaxRate>(`${base(companyId, isPlatform)}/tax-rates/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      // ✅ Invalidar todas las listas de tasas para forzar el refetch
      void qc.invalidateQueries({ queryKey: [...settingsKeys.all, 'taxRates'] });
    },
  });
}

// -------------------------- Payment methods --------------------------
export function usePaymentMethods(companyId: string, isPlatform: boolean) {
  return useQuery({
    queryKey: settingsKeys.paymentMethods(companyId, isPlatform),
    queryFn: () =>
      apiData<PaymentMethod[]>(`${base(companyId, isPlatform)}/payment-methods`),
    enabled: !!companyId,
  });
}

export interface CreatePaymentMethodInput {
  code: string;
  name: string;
}

export interface UpdatePaymentMethodInput {
  name?: string;
  isActive?: boolean;
}

export function useCreatePaymentMethod(companyId: string, isPlatform: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePaymentMethodInput) =>
      apiData<PaymentMethod>(`${base(companyId, isPlatform)}/payment-methods`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
        void qc.invalidateQueries({ queryKey: settingsKeys.paymentMethods(companyId, isPlatform) });
      void qc.invalidateQueries({ queryKey: ['payment-methods', 'active', companyId] });
    },
  });
}

export function useUpdatePaymentMethod(
  companyId: string,
  isPlatform: boolean,
  id: string,
) {
  const qc = useQueryClient();
  const methodsKey = settingsKeys.paymentMethods(companyId, isPlatform);
  const activeMethodsKey = ['payment-methods', 'active', companyId, isPlatform] as const;
  return useMutation({
    mutationFn: (input: UpdatePaymentMethodInput) =>
      apiData<PaymentMethod>(`${base(companyId, isPlatform)}/payment-methods/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    onMutate: async () => {
      await Promise.all([
        qc.cancelQueries({ queryKey: methodsKey, exact: true }),
        qc.cancelQueries({ queryKey: activeMethodsKey, exact: true }),
      ]);
    },
    onSuccess: (updated) => {
      qc.setQueryData<PaymentMethod[]>(methodsKey, (methods) =>
        methods?.map((method) => method.id === updated.id ? updated : method),
      );
      qc.setQueryData<PaymentMethod[]>(activeMethodsKey, (methods) => {
        if (!methods) return methods;
        const remaining = methods.filter((method) => method.id !== updated.id);
        return updated.is_active ? [...remaining, updated].sort((a, b) => a.name.localeCompare(b.name)) : remaining;
      });
    },
  });
}