import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiPaginated } from '../../shared/api/helpers';
import { useAuth } from '../../shared/auth/AuthProvider';
import type { Company } from '../../shared/api/types';

const STORAGE_KEY = 'activeCompanyId';

interface ActiveCompanyValue {
  companyId: string | null;
  companies: Company[];
  isPlatform: boolean;
  isLoading: boolean;
  setCompanyId: (id: string) => void;
}

const Ctx = createContext<ActiveCompanyValue | null>(null);

export function ActiveCompanyProvider({ children }: { children: ReactNode }) {
  const { claims, isPlatform, isAuthenticated } = useAuth();

  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  // Platform: carga la lista de empresas para el selector.
  const companiesQuery = useQuery({
    queryKey: ['active-company', 'list'],
    queryFn: () => apiPaginated<Company>('/platform/companies?page=1&limit=100'),
    enabled: isAuthenticated && isPlatform,
    staleTime: 60_000,
  });

  const companies = companiesQuery.data?.items ?? [];

  // Asegura que haya una empresa seleccionada cuando el usuario es platform.
  useEffect(() => {
    if (!isPlatform) return;
    if (selected && companies.some((c: Company) => c.id === selected)) return;
    const first = companies[0]?.id ?? null;
    setSelected(first);
    try {
      if (first) localStorage.setItem(STORAGE_KEY, first);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }, [isPlatform, companies, selected]);

  const setCompanyId = (id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* noop */
    }
  };

  const companyId = isPlatform ? selected : (claims?.cid ?? null);

  const value = useMemo<ActiveCompanyValue>(
    () => ({
      companyId,
      companies,
      isPlatform,
      isLoading: isPlatform && companiesQuery.isLoading,
      setCompanyId,
    }),
    [companyId, companies, isPlatform, companiesQuery.isLoading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveCompany(): ActiveCompanyValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useActiveCompany fuera de <ActiveCompanyProvider>.');
  return v;
}