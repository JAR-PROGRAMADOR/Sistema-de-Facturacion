import { useState } from 'react';
import { ApiError } from '../../shared/api/error';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useAuditLogs } from './api';

export function AuditPage() {
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const query = useAuditLogs(companyId, isPlatform, action, result);

  if (companyLoading || query.isLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) return <section className="card"><h1>Auditoría</h1><p className="muted">Selecciona una empresa para consultar la auditoría.</p></section>;
  if (query.isError) return <section className="card"><p className="field__error">{query.error instanceof ApiError ? query.error.message : 'No fue posible cargar la auditoría.'}</p></section>;

  const items = query.data?.items ?? [];
  return (
    <section className="card">
      <header className="page-header"><div><h1>Auditoría</h1><p className="muted">{query.data?.total ?? 0} evento(s)</p></div></header>
      <div className="filters">
        <label className="field"><span>Acción</span><input className="input" value={action} onChange={(event) => setAction(event.target.value)} placeholder="auth.login, sale.created…" /></label>
        <label className="field"><span>Resultado</span><select className="input" value={result} onChange={(event) => setResult(event.target.value)}><option value="">Todos</option><option value="OK">Correcto</option><option value="ERROR">Error</option></select></label>
      </div>
      {items.length === 0 ? <p className="muted">No hay eventos para estos filtros.</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Recurso</th><th>Resultado</th><th>IP</th></tr></thead>
          <tbody>{items.map((entry) => (
            <tr key={entry.id}>
              <td>{new Date(entry.created_at).toLocaleString()}</td>
              <td>{entry.user_name || entry.user_id || 'Sistema'}</td>
              <td>{entry.action}</td>
              <td>{entry.resource_type ? `${entry.resource_type}${entry.resource_id ? ` · ${entry.resource_id}` : ''}` : '—'}</td>
              <td><span className={`status ${entry.result === 'OK' ? 'status--ok' : 'status--off'}`}>{entry.result}</span></td>
              <td>{entry.ip || '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
