import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../shared/auth/AuthProvider';
import { CompanyPicker } from '../shared/ui/CompanyPicker';
import { LANGUAGES } from '../i18n';

export function Layout() {
  const { t, i18n } = useTranslation();
  const { signOut, isPlatform, claims } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === '/inicio';

  const handleSignOut = async () => {
    await signOut();
    nav('/login', { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'sidebar__link sidebar__link--active' : 'sidebar__link';

  return (
    <div className={`app-shell${isDashboard ? ' app-shell--dashboard' : ''}`}>
      <aside className="sidebar">
        <h2 className="sidebar__brand">{t('app.title')}</h2>
        <nav className="sidebar__nav">
          <NavLink to="/inicio" className={linkClass}>
            Inicio
          </NavLink>
          {isPlatform && (
            <>
              <NavLink to="/empresas" className={linkClass}>
                {t('nav.companies', 'Empresas')}
              </NavLink>
              <NavLink to="/licencias" className={linkClass}>
                Licencias
              </NavLink>
            </>
          )}
          <NavLink to="/roles" className={linkClass}>
            {t('nav.roles', 'Roles')}
          </NavLink>
          <NavLink to="/usuarios" className={linkClass}>
            {t('nav.users', 'Usuarios')}
          </NavLink>
          <NavLink to="/productos" className={linkClass}>
            Productos
          </NavLink>
          <NavLink to="/categorias" className={linkClass}>
            Categorías
          </NavLink>
          <NavLink to="/inventario" className={linkClass}>
            Inventario
          </NavLink>
          <NavLink to="/clientes" className={linkClass}>
            Clientes
          </NavLink>
          <NavLink to="/proveedores" className={linkClass}>
            Proveedores
          </NavLink>
          <NavLink to="/ventas" className={linkClass}>
            Ventas
          </NavLink>
          <NavLink to="/caja" className={linkClass}>
            Caja
          </NavLink>
          <NavLink to="/facturas" className={linkClass}>
            Facturas
          </NavLink>
          <NavLink to="/reportes" className={linkClass}>
            Reportes
          </NavLink>
          <NavLink to="/auditoria" className={linkClass}>
            Auditoría
          </NavLink>
          <NavLink to="/compras" className={linkClass}>
            Compras
          </NavLink>
        <NavLink to="/configuracion" className={linkClass}>
            Configuración
        </NavLink>
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="app-header__meta">
            <span className="app-header__title">{isDashboard ? 'Panel de control' : (claims?.sub != null ? String(claims.sub) : '')}</span>
            {isPlatform && <span className="badge">{t('auth.platform', 'Plataforma')}</span>}
          </div>
          <div className="app-header__actions">
            <CompanyPicker />
            <select
              value={i18n.resolvedLanguage}
              onChange={(e) => void i18n.changeLanguage(e.target.value)}
              aria-label={t('language')}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn--ghost" onClick={handleSignOut}>
              {t('auth.signOut', 'Salir')}
            </button>
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}