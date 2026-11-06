import { useState } from 'react';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { useUsers } from '../users/api';
import {
  useCompanyLicenses,
  useIssueCompanyLicense,
  useIssueRegistrationLicense,
  useIssueUserLicense,
  useSetLicenseStatus,
  useUserLicenses,
} from './api';

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export function LicensesPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const [companyDays, setCompanyDays] = useState(365);
  const [maxUsers, setMaxUsers] = useState(5);
  const [userDays, setUserDays] = useState(365);
  const [registrationDays, setRegistrationDays] = useState(365);
  const [userId, setUserId] = useState('');
  const [issuedKey, setIssuedKey] = useState<{ key: string; label: string } | null>(null);

  const usersQuery = useUsers(companyId, isPlatform, 1, 100);
  const companyLicenses = useCompanyLicenses(companyId);
  const userLicenses = useUserLicenses(companyId, userId);
  const createCompany = useIssueCompanyLicense(companyId);
  const createRegistration = useIssueRegistrationLicense();
  const createUser = useIssueUserLicense(companyId, userId);
  const changeCompanyStatus = useSetLicenseStatus(companyId, 'company');
  const changeUserStatus = useSetLicenseStatus(companyId, 'user', userId);
  const users = (usersQuery.data?.items ?? []).filter((user) => user.status === 'ACTIVO');
  const allLoading = companyLoading || usersQuery.isLoading || companyLicenses.isLoading;

  const submitCompanyLicense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!companyId) return;
    try {
      const result = await createCompany.mutateAsync({ durationSeconds: Number(companyDays) * 86_400, maxUsers: Number(maxUsers) });
      setIssuedKey({ key: result.key, label: 'Código de licencia de empresa' });
      push('success', 'Código de empresa emitido. Anota el código de 6 dígitos ahora; no volverá a mostrarse.');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible emitir la licencia.');
    }
  };

  const submitUserLicense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!companyId || !userId) return;
    try {
      const result = await createUser.mutateAsync({ durationSeconds: Number(userDays) * 86_400 });
      setIssuedKey({ key: result.key, label: 'Código de licencia de usuario' });
      push('success', 'Código de usuario emitido. Anota el código de 6 dígitos ahora; no volverá a mostrarse.');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible emitir la licencia de usuario.');
    }
  };

  const submitRegistrationLicense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await createRegistration.mutateAsync({
        durationSeconds: Number(registrationDays) * 86_400,
        maxUsers: Number(maxUsers),
      });
      setIssuedKey({ key: result.key, label: 'Código de registro de un solo uso' });
      push('success', 'Código de registro emitido. Al canjearlo se activarán ambas licencias.');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible emitir el código de registro.');
    }
  };

  const updateStatus = async (scope: 'company' | 'user', licenseId: string, status: 'SUSPENDIDA' | 'REVOCADA') => {
    try {
      await (scope === 'company' ? changeCompanyStatus : changeUserStatus).mutateAsync({ licenseId, status });
      push('success', `Licencia ${status.toLowerCase()}.`);
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible cambiar el estado de la licencia.');
    }
  };

  if (!isPlatform) return <section className="card"><h1>Licencias</h1><p className="muted">Esta vista solo está disponible para la plataforma.</p></section>;
  if (allLoading) return <div className="center"><Spinner /></div>;

  return (
    <div className="stack">
      <section className="card">
        <header className="page-header"><div><h1>Licencias</h1><p className="muted">Emite códigos de 6 dígitos para la empresa seleccionada, o un código de registro para una empresa nueva.</p></div></header>
        {issuedKey && (
          <div className="field" style={{ marginBottom: 20 }}>
            <strong>{issuedKey.label}</strong>
            <code style={{ display: 'block', overflowWrap: 'anywhere', padding: 12, background: '#f3f4f6', fontSize: 28, letterSpacing: 8, textAlign: 'center' }}>{issuedKey.key}</code>
            <Button variant="ghost" onClick={() => setIssuedKey(null)}>Ocultar código</Button>
          </div>
        )}
        <p className="muted">El código de registro no necesita una empresa seleccionada: es el primer código que se emite cuando todavía no hay empresas.</p>
      </section>

      <section className="card">
        <h2>Código para un nuevo registro</h2>
        <p className="muted">Canjearlo durante el registro activa la licencia de empresa y la del usuario administrador. También se puede escribir en la pantalla de activación de una empresa que ya existe. Cada código se usa una sola vez.</p>
        <form className="grid-2" onSubmit={submitRegistrationLicense}>
          <label className="field"><span>Vigencia (días)</span><input className="input" type="number" min="1" max="3650" value={registrationDays} onChange={(event) => setRegistrationDays(Number(event.target.value))} /></label>
          <label className="field"><span>Cupo máximo de usuarios</span><input className="input" type="number" min="1" max="100000" value={maxUsers} onChange={(event) => setMaxUsers(Number(event.target.value))} /></label>
          <div><Button type="submit" disabled={createRegistration.isPending}>{createRegistration.isPending ? 'Emitiendo…' : 'Emitir código de registro'}</Button></div>
        </form>
      </section>

      {!companyId ? (
        <section className="card"><h2>Licencias de una empresa</h2><p className="muted">Selecciona una empresa arriba (selector «Empresa») para emitir o ver sus licencias de empresa y de usuario.</p></section>
      ) : (
        <>
      <section className="card">
        <h2>Emitir licencia de empresa</h2>
        <form className="grid-2" onSubmit={submitCompanyLicense}>
          <label className="field"><span>Vigencia de empresa (días)</span><input className="input" type="number" min="1" max="3650" value={companyDays} onChange={(event) => setCompanyDays(Number(event.target.value))} /></label>
          <label className="field"><span>Cupo máximo de usuarios</span><input className="input" type="number" min="1" max="100000" value={maxUsers} onChange={(event) => setMaxUsers(Number(event.target.value))} /></label>
          <div><Button type="submit" disabled={createCompany.isPending}>{createCompany.isPending ? 'Emitiendo…' : 'Emitir licencia de empresa'}</Button></div>
        </form>
      </section>

      <section className="card">
        <h2>Licencias de empresa</h2>
        {companyLicenses.isError ? <p className="field__error">No fue posible cargar las licencias.</p> : (companyLicenses.data?.length ?? 0) === 0 ? <p className="muted">No hay licencias emitidas.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Estado</th><th>Inicio</th><th>Vence</th><th>Cupo</th><th>Acciones</th></tr></thead>
            <tbody>{companyLicenses.data!.map((license) => (
              <tr key={license.id}>
                <td>{license.status}</td><td>{formatDate(license.starts_at)}</td><td>{formatDate(license.expires_at)}</td><td>{license.max_users}</td>
                <td className="row-actions"><Button variant="ghost" disabled={license.status === 'REVOCADA' || changeCompanyStatus.isPending} onClick={() => void updateStatus('company', license.id, 'SUSPENDIDA')}>Suspender</Button><Button variant="danger" disabled={license.status === 'REVOCADA' || changeCompanyStatus.isPending} onClick={() => void updateStatus('company', license.id, 'REVOCADA')}>Revocar</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>Licencias por usuario</h2>
        <form className="grid-2" onSubmit={submitUserLicense}>
          <label className="field"><span>Usuario</span><select className="input" value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Selecciona un usuario activo</option>{users.map((user) => <option key={user.id} value={user.id}>{user.fullName} · {user.email}</option>)}</select></label>
          <label className="field"><span>Vigencia (días)</span><input className="input" type="number" min="1" max="3650" value={userDays} onChange={(event) => setUserDays(Number(event.target.value))} /></label>
          <div><Button type="submit" disabled={!userId || createUser.isPending}>{createUser.isPending ? 'Emitiendo…' : 'Emitir licencia de usuario'}</Button></div>
        </form>
        {userId && (userLicenses.isLoading ? <div className="center"><Spinner /></div> : userLicenses.isError ? <p className="field__error">No fue posible cargar las licencias de usuario.</p> : (
          <div className="table-wrap" style={{ marginTop: 16 }}><table className="table">
            <thead><tr><th>Estado</th><th>Inicio</th><th>Vence</th><th>Acciones</th></tr></thead>
            <tbody>{(userLicenses.data ?? []).map((license) => (
              <tr key={license.id}>
                <td>{license.status}</td><td>{formatDate(license.starts_at)}</td><td>{formatDate(license.expires_at)}</td>
                <td className="row-actions"><Button variant="ghost" disabled={license.status === 'REVOCADA' || changeUserStatus.isPending} onClick={() => void updateStatus('user', license.id, 'SUSPENDIDA')}>Suspender</Button><Button variant="danger" disabled={license.status === 'REVOCADA' || changeUserStatus.isPending} onClick={() => void updateStatus('user', license.id, 'REVOCADA')}>Revocar</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        ))}
      </section>
        </>
      )}
    </div>
  );
}
