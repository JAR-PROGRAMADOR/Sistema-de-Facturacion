export interface AccessClaims {
  sub: string;
  cid: string | null;
  plat: boolean;
  iat?: number;
  exp?: number;
}

export type CompanyStatus = 'ACTIVA' | 'SUSPENDIDA';

/** Lo que devuelve el backend (SQL row, snake_case). */
export interface Company {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  country: string | null;
  currency: string;
  locale: string;
  timezone: string;
  status: CompanyStatus;
  created_at: string;
  updated_at: string;
}

/** Lo que enviamos al backend (create/update, camelCase). */
export interface CompanyWriteInput {
  name?: string;
  legalName?: string | null;
  taxId?: string | null;
  country?: string | null;
  currency?: string;
  locale?: string;
  timezone?: string;
}

export interface Role {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissionCodes: string[];
}

export interface Permission {
  code: string;
  description: string;
}

export type MembershipStatus = 'ACTIVO' | 'INACTIVO';

export interface UserRoleRef {
  id: string;
  name: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  locale: string;
  status: MembershipStatus;
  isPlatformAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  roles: UserRoleRef[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}