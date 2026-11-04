import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { TaxRatesSection } from './TaxRatesSection';
import { PaymentMethodsSection } from './PaymentMethodsSection';

export function SettingsPage() {
  const { companyId, isPlatform, isLoading } = useActiveCompany();

  if (isLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) {
    return (
      <section className="card">
        <h1>Configuración</h1>
        <p className="muted">Selecciona una empresa en el header.</p>
      </section>
    );
  }

  return (
    <section>
      <header className="page-header">
        <div>
          <h1>Configuración fiscal y de cobros</h1>
          <p className="muted">
            Tasas de impuesto y métodos de pago disponibles para esta empresa.
          </p>
        </div>
      </header>

      <TaxRatesSection companyId={companyId} isPlatform={isPlatform} />
      <PaymentMethodsSection companyId={companyId} isPlatform={isPlatform} />
    </section>
  );
}