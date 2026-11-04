import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useAuth } from '../../shared/auth/AuthProvider';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { useActivateLicense, useLicenseStatus } from './api';

function stateLabel(state: string | undefined): string {
  switch (state) {
    case 'ACTIVA': return 'Activa';
    case 'PENDIENTE': return 'Pendiente de activación';
    case 'SUSPENDIDA': return 'Suspendida';
    case 'REVOCADA': return 'Revocada';
    case 'VENCIDA': return 'Vencida';
    default: return 'No asignada';
  }
}

export function LicenseGate() {
  const { isPlatform, companyId } = useActiveCompany();
  const { signOut } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const statusQuery = useLicenseStatus(companyId);
  const activate = useActivateLicense(companyId);
  const [key, setKey] = useState('');

  if (isPlatform) return <Outlet />;
  if (statusQuery.isLoading) return <div className="center"><Spinner /></div>;

  if (statusQuery.isError) {
    return (
      <main className="auth-shell">
        <section className="card auth-card">
          <h1>No se pudo verificar la licencia</h1>
          <p className="muted">{statusQuery.error instanceof ApiError ? statusQuery.error.message : 'No hay conexión con el servicio de licencias.'}</p>
          <Button onClick={() => void statusQuery.refetch()}>Reintentar</Button>
          <Button variant="ghost" onClick={() => void signOut().then(() => navigate('/login', { replace: true }))}>Cerrar sesión</Button>
        </section>
      </main>
    );
  }

  if (statusQuery.data?.canOperate) return <Outlet />;

  const status = statusQuery.data;
  const expiresAt = status?.company?.expires_at ? new Date(status.company.expires_at).toLocaleString() : null;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await activate.mutateAsync(key.trim());
      setKey('');
      push('success', `Licencia de ${result.scope === 'company' ? 'empresa' : 'usuario'} activada.`);
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible activar la licencia.');
    }
  };

  return (
    <main className="auth-shell">
      <section className="card auth-card">
        <h1>Renovar licencia</h1>
        <p>El acceso está bloqueado hasta que estén activas las licencias requeridas.</p>
        <div className="grid-2">
          <div><span className="muted">Licencia de empresa</span><div><strong>{stateLabel(status?.company?.status)}</strong></div>{expiresAt && <small className="muted">Vence: {expiresAt}</small>}</div>
          <div><span className="muted">Licencia de usuario</span><div><strong>{stateLabel(status?.user?.status)}</strong></div>{status?.user?.expires_at && <small className="muted">Vence: {new Date(status.user.expires_at).toLocaleString()}</small>}</div>
        </div>
        {status?.maxUsers !== null && status?.maxUsers !== undefined && <p className="muted">Usuarios activos: {status.activeUsers} / {status.maxUsers}</p>}
        <form className="stack" onSubmit={submit}>
          <label className="field"><span>Clave de activación</span><input className="input" value={key} onChange={(event) => setKey(event.target.value)} required minLength={20} maxLength={128} autoComplete="off" /></label>
          <Button type="submit" disabled={activate.isPending}>{activate.isPending ? 'Activando…' : 'Activar licencia'}</Button>
        </form>
        <Button variant="ghost" onClick={() => void signOut().then(() => navigate('/login', { replace: true }))}>Cerrar sesión</Button>
      </section>
    </main>
  );
}
