import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function ProtectedRoute({ requirePlatform = false }: { requirePlatform?: boolean }) {
  const { ready, isAuthenticated, isPlatform } = useAuth();
  const loc = useLocation();

  if (!ready) return null; // evita flash de redirect mientras se restaura la sesión
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  }
  if (requirePlatform && !isPlatform) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}