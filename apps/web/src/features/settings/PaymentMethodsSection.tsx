import { useState } from 'react';
import { Button } from '../../shared/auth/Button';
import { Field } from '../../shared/ui/Field';
import { Input } from '../../shared/ui/Input';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { ApiError } from '../../shared/api/error';
import {
  usePaymentMethods,
  useCreatePaymentMethod,
  useUpdatePaymentMethod,
  type PaymentMethod,
} from './api';

interface Props {
  companyId: string;
  isPlatform: boolean;
}

export function PaymentMethodsSection({ companyId, isPlatform }: Props) {
  const { push } = useToast();
  const query = usePaymentMethods(companyId, isPlatform);

  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');

  const createMutation = useCreatePaymentMethod(companyId, isPlatform);

  const handleCreate = async () => {
    const code = newCode.trim().toUpperCase().replace(/\s+/g, '_');
    if (!code || !newName.trim()) {
      push('error', 'Código y nombre son obligatorios.');
      return;
    }
    try {
      await createMutation.mutateAsync({ code, name: newName.trim() });
      push('success', 'Método de pago creado.');
      setAdding(false);
      setNewCode('');
      setNewName('');
    } catch (err) {
      push('error', err instanceof ApiError ? err.message : 'No fue posible crear.');
    }
  };

  if (query.isLoading) return <div className="center"><Spinner /></div>;
  if (query.isError || !query.data)
    return <p className="field__error">Error al cargar métodos de pago.</p>;

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <header className="page-header">
        <div>
          <h2>Métodos de pago</h2>
          <p className="muted">Los activos aparecen al cobrar una venta.</p>
        </div>
        <Button onClick={() => setAdding(true)}>Añadir método</Button>
      </header>

      {adding && (
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <Field label="Código *">
            <Input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="PAYPAL"
            />
          </Field>
          <Field label="Nombre *">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="PayPal"
            />
          </Field>
          <div className="row-actions" style={{ gridColumn: '1 / -1' }}>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creando…' : 'Crear'}
            </Button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data.map((pm) => (
              <PaymentMethodRow
                key={pm.id}
                pm={pm}
                companyId={companyId}
                isPlatform={isPlatform}
                onError={(m) => push('error', m)}
                onOk={(m) => push('success', m)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PaymentMethodRow({
  pm,
  companyId,
  isPlatform,
  onOk,
  onError,
}: {
  pm: PaymentMethod;
  companyId: string;
  isPlatform: boolean;
  onOk: (m: string) => void;
  onError: (m: string) => void;
}) {
  const update = useUpdatePaymentMethod(companyId, isPlatform, pm.id);

  const handleToggle = async () => {
    try {
      await update.mutateAsync({ isActive: !pm.is_active });
      onOk(pm.is_active ? 'Método desactivado.' : 'Método activado.');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'No fue posible actualizar.');
    }
  };

  return (
    <tr>
      <td><code>{pm.code}</code></td>
      <td>{pm.name}</td>
      <td>
        <span className={`status status--${pm.is_active ? 'ok' : 'off'}`}>
          {pm.is_active ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td>
        <Button
          variant={pm.is_active ? 'danger' : 'primary'}
          onClick={handleToggle}
          disabled={update.isPending}
        >
          {pm.is_active ? 'Desactivar' : 'Activar'}
        </Button>
      </td>
    </tr>
  );
}