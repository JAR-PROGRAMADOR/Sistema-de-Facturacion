import { useActiveCompany } from '../auth/ActiveCompanyContext';

export function CompanyPicker() {
  const { isPlatform, companyId, companies, setCompanyId, isLoading } = useActiveCompany();

  if (!isPlatform) return null;
  if (isLoading) return <span className="muted">Cargando empresas…</span>;
  if (companies.length === 0) {
    return <span className="muted">Sin empresas — crea una primero.</span>;
  }

  return (
    <label className="company-picker">
      <span className="muted">Empresa:</span>
      <select
        className="input"
        value={companyId ?? ''}
        onChange={(e) => setCompanyId(e.target.value)}
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}