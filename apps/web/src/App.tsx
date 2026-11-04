import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './shared/auth/AuthProvider';
import { ProtectedRoute } from './shared/auth/ProtectedRoute';
import { ToastProvider } from './shared/ui/Toast';
import { Layout } from './app/Layout';
import { PlaceholderPage } from './app/PlaceholderPage';
import { NotFoundPage } from './app/NotFoundPage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { CompaniesPage } from './features/companies/CompaniesPage';
import { ActiveCompanyProvider } from './shared/auth/ActiveCompanyContext';
import { RolesPage } from './features/roles/RolesPage';
import { UsersPage } from './features/users/UsersPage';
import { ProductsPage } from './features/products/ProductsPage';
import { InventoryPage } from './features/products/InventoryPage';
import { CustomersPage } from './features/customers/CustomersPage';
import { SuppliersPage } from './features/suppliers/SuppliersPage';
import { SalesPage } from './features/sales/SalesPage';
import { CashPage } from './features/cash/CashPage';
import { InvoicesPage } from './features/sales/InvoicesPage';
import { LicenseGate } from './features/licenses/LicenseGate';
import { LicensesPage } from './features/licenses/LicensesPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { AuditPage } from './features/audit/AuditPage';
import { PurchasesPage } from './features/purchases/PurchasesPage';
import { CategoriesPage } from './features/products/CategoriesPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { DashboardPage } from './features/reports/DashboardPage';
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ActiveCompanyProvider>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/registro" element={<RegisterPage />} />
                <Route path="/recuperar" element={<ForgotPasswordPage />} />
                <Route path="/restablecer" element={<ResetPasswordPage />} />

                <Route element={<ProtectedRoute />}>
                  <Route element={<LicenseGate />}>
                    <Route element={<Layout />}>
                      <Route path="/" element={<Navigate to="/inicio" replace />} />

                      <Route path="/inicio" element={<DashboardPage />} />
                      <Route path="/roles" element={<RolesPage />} />
                      <Route path="/usuarios" element={<UsersPage />} />
                      <Route path="/productos" element={<ProductsPage />} />
                      <Route path="/categorias" element={<CategoriesPage />} />
                      <Route path="/inventario" element={<InventoryPage />} />
                      <Route path="/clientes" element={<CustomersPage />} />
                      <Route path="/proveedores" element={<SuppliersPage />} />
                      <Route path="/ventas" element={<SalesPage />} />
                      <Route path="/caja" element={<CashPage />} />
                      <Route path="/facturas" element={<InvoicesPage />} />
                      <Route path="/reportes" element={<ReportsPage />} />
                      <Route path="/auditoria" element={<AuditPage />} />
                      <Route path="/configuracion" element={<SettingsPage />} />
                      <Route path="/compras" element={<PurchasesPage />} />

                      <Route element={<ProtectedRoute requirePlatform />}>
                        <Route path="/empresas" element={<CompaniesPage />} />
                        <Route path="/licencias" element={<LicensesPage />} />
                      </Route>
                    </Route>
                  </Route>
                </Route>

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </ActiveCompanyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}