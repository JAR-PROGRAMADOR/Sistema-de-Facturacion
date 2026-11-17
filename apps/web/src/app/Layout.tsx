import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../shared/auth/AuthProvider';
import { CompanyPicker } from '../shared/ui/CompanyPicker';
import { Logo } from '../shared/ui/Logo';
import { NavIcon, type NavIconName } from '../shared/ui/NavIcon';
import { LANGUAGES } from '../i18n';

export function Layout() {
  const { t, i18n } = useTranslation();
  const { signOut, isPlatform } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === '/inicio';

  // Título de la página según la ruta. Antes mostraba el id del usuario
  // (claims.sub, un UUID), que se veía feo junto a la insignia Plataforma.
  const pageTitles: Record<string, string> = {
    '/inicio': 'Panel de control',
    '/empresas': t('nav.companies', 'Empresas'),
    '/licencias': 'Licencias',
    '/roles': t('nav.roles', 'Roles'),
    '/usuarios': t('nav.users', 'Usuarios'),
    '/productos': 'Productos',
    '/categorias': 'Categorías',
    '/inventario': 'Inventario',
    '/clientes': 'Clientes',
    '/proveedores': 'Proveedores',
    '/ventas': 'Ventas',
    '/caja': 'Caja',
    '/facturas': 'Facturas',
    '/reportes': 'Reportes',
    '/auditoria': 'Auditoría',
    '/compras': 'Compras',
    '/configuracion': 'Configuración',
  };
  const pageTitle = pageTitles[location.pathname] ?? '';

  const handleSignOut = async () => {
    await signOut();
    nav('/login', { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'sidebar__link sidebar__link--active' : 'sidebar__link';

  // Menú lateral organizado en grupos plegables. Cada opción lleva su icono
  // (una llave para Licencias, etc.) además del texto, para reconocerla
  // de un vistazo y no solo por las letras.
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (label: string) =>
    setClosedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  const navGroups: Array<{ label: string; links: Array<{ to: string; label: string; icon: NavIconName }> }> = [
    {
      label: 'Ventas',
      links: [
        { to: '/ventas', label: 'Ventas', icon: 'sales' },
        { to: '/facturas', label: 'Facturas', icon: 'invoices' },
        { to: '/caja', label: 'Caja', icon: 'cash' },
        { to: '/clientes', label: 'Clientes', icon: 'customers' },
      ],
    },
    {
      label: 'Inventario',
      links: [
        { to: '/productos', label: 'Productos', icon: 'products' },
        { to: '/categorias', label: 'Categorías', icon: 'categories' },
        { to: '/inventario', label: 'Inventario', icon: 'inventory' },
        { to: '/proveedores', label: 'Proveedores', icon: 'suppliers' },
        { to: '/compras', label: 'Compras', icon: 'purchases' },
      ],
    },
    {
      label: 'Administración',
      links: [
        { to: '/usuarios', label: t('nav.users', 'Usuarios'), icon: 'users' },
        { to: '/roles', label: t('nav.roles', 'Roles'), icon: 'roles' },
        { to: '/reportes', label: 'Reportes', icon: 'reports' },
        { to: '/auditoria', label: 'Auditoría', icon: 'audit' },
        { to: '/configuracion', label: 'Configuración', icon: 'settings' },
      ],
    },
  ];

  return (
    <div className={`app-shell${isDashboard ? ' app-shell--dashboard' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Logo />
        </div>
        <nav className="sidebar__nav">
          <NavLink to="/inicio" className={linkClass}>
            <NavIcon name="home" />
            <span>Inicio</span>
          </NavLink>
          {isPlatform && (
            <section className="sidebar__group">
              <button
                type="button"
                className="sidebar__group-toggle"
                onClick={() => toggleGroup('Plataforma')}
                aria-expanded={!closedGroups['Plataforma']}
              >
                <span>Plataforma</span>
                <span className={`sidebar__chevron${closedGroups['Plataforma'] ? ' sidebar__chevron--closed' : ''}`} aria-hidden="true">
                  <NavIcon name="chevron" size={14} />
                </span>
              </button>
              {!closedGroups['Plataforma'] && (
                <div className="sidebar__group-links">
                  <NavLink to="/empresas" className={linkClass}>
                    <NavIcon name="companies" />
                    <span>{t('nav.companies', 'Empresas')}</span>
                  </NavLink>
                  <NavLink to="/licencias" className={linkClass}>
                    <NavIcon name="licenses" />
                    <span>Licencias</span>
                  </NavLink>
                </div>
              )}
            </section>
          )}
          {navGroups.map((group) => (
            <section key={group.label} className="sidebar__group">
              <button
                type="button"
                className="sidebar__group-toggle"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={!closedGroups[group.label]}
              >
                <span>{group.label}</span>
                <span className={`sidebar__chevron${closedGroups[group.label] ? ' sidebar__chevron--closed' : ''}`} aria-hidden="true">
                  <NavIcon name="chevron" size={14} />
                </span>
              </button>
              {!closedGroups[group.label] && (
                <div className="sidebar__group-links">
                  {group.links.map((link) => (
                    <NavLink key={link.to} to={link.to} className={linkClass}>
                      <NavIcon name={link.icon} />
                      <span>{link.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </section>
          ))}
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="app-header__meta">
            <span className="app-header__title">{pageTitle}</span>
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