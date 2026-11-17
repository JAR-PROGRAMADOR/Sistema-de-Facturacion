import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartBar, Receipt, ShieldCheck } from '@phosphor-icons/react';
import { Logo } from './Logo';

// Pantallas de autenticación (patrón Hero + Features de la skill UI/UX Pro
// Max): a la izquierda un panel de marca con titular, propuesta de valor y
// tres funciones clave; a la derecha el formulario. En móvil el panel se
// oculta y la tarjeta muestra su propio logo. No cambia la lógica de ningún
// formulario: solo el diseño que lo envuelve.
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const features = [
    {
      icon: Receipt,
      title: t('auth.heroFeatureInvoices', 'Facturas en segundos'),
      text: t('auth.heroFeatureInvoicesText', 'Crea y envía facturas con IVA, series y pagos.'),
    },
    {
      icon: ChartBar,
      title: t('auth.heroFeatureSales', 'Ventas e inventario al día'),
      text: t('auth.heroFeatureSalesText', 'Stock, clientes y caja siempre actualizados.'),
    },
    {
      icon: ShieldCheck,
      title: t('auth.heroFeatureLicenses', 'Licencias por empresa y usuario'),
      text: t('auth.heroFeatureLicensesText', 'Cada empresa y cada usuario con su propia licencia.'),
    },
  ];

  return (
    <main className="auth-shell">
      <aside className="auth-hero">
        <Logo size={44} />
        <p className="auth-hero__title">
          {t('auth.heroTitle', 'Factura, vende y cobra sin enredos.')}
        </p>
        <p className="auth-hero__subtitle">
          {t('auth.heroSubtitle', 'Facturación, inventario y ventas en un solo lugar.')}
        </p>
        <ul className="auth-hero__features">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.title}>
                <span className="auth-hero__feature-icon">
                  <Icon size={20} weight="regular" aria-hidden="true" />
                </span>
                <span className="auth-hero__feature-text">
                  <strong>{feature.title}</strong>
                  <span>{feature.text}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="auth-form">
        <div className="auth-brand">
          <Logo size={44} />
          <p className="auth-brand__title">
            {t('auth.heroTitle', 'Factura, vende y cobra sin enredos.')}
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
