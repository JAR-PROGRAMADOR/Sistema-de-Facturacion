import { useState } from 'react';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { useCashMovement, useCloseCash, useOpenCash, useOpenCashSession } from './api';

export function CashPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const sessionQuery = useOpenCashSession(companyId, isPlatform);
  const session = sessionQuery.data ?? null;
  const openCash = useOpenCash(companyId, isPlatform);
  const closeCash = useCloseCash(companyId, isPlatform, session?.id ?? '');
  const movement = useCashMovement(companyId, isPlatform, session?.id ?? '');
  const [openingAmount, setOpeningAmount] = useState(0);
  const [closingAmount, setClosingAmount] = useState(0);
  const [movementType, setMovementType] = useState<'INGRESO' | 'EGRESO'>('INGRESO');
  const [movementAmount, setMovementAmount] = useState(0);
  const [reason, setReason] = useState('');

  const handleOpen = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await openCash.mutateAsync(Number(openingAmount));
      push('success', 'Turno de caja abierto.');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible abrir la caja.');
    }
  };

  const handleMovement = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await movement.mutateAsync({ type: movementType, amount: Number(movementAmount), reason: reason.trim() });
      setMovementAmount(0);
      setReason('');
      push('success', 'Movimiento registrado.');
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible registrar el movimiento.');
    }
  };

  const handleClose = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const closed = await closeCash.mutateAsync(Number(closingAmount));
      push('success', `Caja cerrada. Esperado: ${closed.closing_amount_expected?.toFixed(2) ?? '0.00'}.`);
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible cerrar la caja.');
    }
  };

  if (companyLoading || sessionQuery.isLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) return <section className="card"><h1>Caja</h1><p className="muted">Selecciona una empresa para operar caja.</p></section>;
  if (sessionQuery.isError) return <section className="card"><p className="field__error">No fue posible cargar el turno de caja.</p></section>;

  if (!session) {
    return (
      <section className="card">
        <header className="page-header"><div><h1>Apertura de caja</h1><p className="muted">Registra el fondo inicial para comenzar a cobrar en efectivo.</p></div></header>
        <form className="modal__body" onSubmit={handleOpen}>
          <label className="field"><span>Fondo inicial</span><input className="input" type="number" min="0" step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(Number(event.target.value))} /></label>
          <Button type="submit" disabled={openCash.isPending}>{openCash.isPending ? 'Abriendo…' : 'Abrir turno'}</Button>
        </form>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <header className="page-header"><div><h1>Caja abierta</h1><p className="muted">Abierta {new Date(session.opened_at).toLocaleString()}</p></div><span className="status status--ok">ABIERTA</span></header>
        <p>Fondo inicial: <strong>{session.opening_amount.toFixed(2)}</strong></p>
      </section>
      <section className="card">
        <h2>Movimiento manual</h2>
        <form className="grid-2" onSubmit={handleMovement}>
          <label className="field"><span>Tipo</span><select className="input" value={movementType} onChange={(event) => setMovementType(event.target.value as 'INGRESO' | 'EGRESO')}><option value="INGRESO">Ingreso</option><option value="EGRESO">Egreso</option></select></label>
          <label className="field"><span>Importe</span><input className="input" type="number" min="0.01" step="0.01" value={movementAmount} onChange={(event) => setMovementAmount(Number(event.target.value))} /></label>
          <label className="field"><span>Motivo</span><input className="input" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={255} /></label>
          <div><Button type="submit" disabled={movement.isPending || !reason.trim()}>Registrar movimiento</Button></div>
        </form>
      </section>
      <section className="card">
        <h2>Cierre de caja</h2>
        <form className="grid-2" onSubmit={handleClose}>
          <label className="field"><span>Importe contado</span><input className="input" type="number" min="0" step="0.01" value={closingAmount} onChange={(event) => setClosingAmount(Number(event.target.value))} /></label>
          <div><Button variant="danger" type="submit" disabled={closeCash.isPending}>{closeCash.isPending ? 'Cerrando…' : 'Cerrar turno'}</Button></div>
        </form>
      </section>
    </div>
  );
}
