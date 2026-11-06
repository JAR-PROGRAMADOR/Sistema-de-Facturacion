import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useAuth } from '../../shared/auth/AuthProvider';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { useActivateLicense, useLicenseStatus } from './api';

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

  if (statusQuery.data?.company.active && statusQuery.data.user.active) return <Outlet />;

  const status = statusQuery.data;
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await activate.mutateAsync(key.trim());
      setKey('');
      push(
        'success',
        result.scope === 'both'
          ? 'Licencias de empresa y usuario activadas.'
          : `Licencia de ${result.scope === 'company' ? 'empresa' : 'usuario'} activada.`,
      );
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible activar la licencia.');
    }
  };

  const signOutAndGoToLogin = () => void signOut().then(() => navigate('/login', { replace: true }));

  return (
    <main className="auth-shell">
      <section className="card auth-card">
        <h1>Renovar licencia</h1>
        <p>El acceso está bloqueado hasta que estén activas las licencias requeridas.</p>
        {statusQuery.isError && (
          <p className="field__error">
            No se pudo verificar el estado de la licencia
            {statusQuery.error instanceof ApiError ? `: ${statusQuery.error.message}` : '.'} Puedes
            activar un código de todos modos, o reintentarlo.
          </p>
        )}
        <div className="grid-2">
          <div><span className="muted">Licencia de empresa</span><div><strong>{status?.company.active ? 'Activa' : 'Pendiente, vencida o no asignada'}</strong></div></div>
          <div><span className="muted">Licencia de usuario</span><div><strong>{status?.user.active ? 'Activa' : 'Pendiente, vencida o no asignada'}</strong></div></div>
        </div>
        <p className="muted">
          Necesitas dos códigos, uno de empresa y uno de usuario, o un solo código de registro,
          que activa los dos a la vez. Son 6 dígitos, sin letras: te los da el administrador de
          la plataforma.
        </p>
        <form className="stack" onSubmit={submit}>
          <label className="field"><span>Código de activación (6 dígitos)</span><input className="input" value={key} onChange={(event) => setKey(event.target.value.replace(/\D/g, '').slice(0, 6))} required minLength={6} maxLength={6} pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" /></label>
          <Button type="submit" disabled={activate.isPending}>{activate.isPending ? 'Activando…' : 'Activar licencia'}</Button>
        </form>
        {statusQuery.isError && (
          <Button variant="ghost" onClick={() => void statusQuery.refetch()}>Reintentar verificación</Button>
        )}
        <Button variant="ghost" onClick={signOutAndGoToLogin}>Cerrar sesión</Button>
      </section>
    </main>
  );
}
