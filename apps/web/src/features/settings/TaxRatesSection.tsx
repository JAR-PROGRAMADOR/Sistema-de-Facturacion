import { useState } from 'react';
import { Button } from '../../shared/auth/Button';
import { Field } from '../../shared/ui/Field';
import { Input } from '../../shared/ui/Input';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { ApiError } from '../../shared/api/error';
import { useTaxRates, useCreateTaxRate, useUpdateTaxRate, type TaxRate } from './api';

interface Props {
  companyId: string;
  isPlatform: boolean;
}

export function TaxRatesSection({ companyId, isPlatform }: Props) {
  const { push } = useToast();
  const query = useTaxRates(companyId, isPlatform);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');

  const createMutation = useCreateTaxRate(companyId, isPlatform);

  const handleCreate = async () => {
    const rate = Number(newRate);
    if (!newName.trim() || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      push('error', 'Nombre y tasa (0–100) son obligatorios.');
      return;
    }
    try {
      await createMutation.mutateAsync({ name: newName.trim(), rate });
      push('success', 'Tasa creada.');
      setAdding(false);
      setNewName('');
      setNewRate('');
    } catch (err) {
      push('error', err instanceof ApiError ? err.message : 'No fue posible crear.');
    }
  };

  if (query.isLoading) return <div className="center"><Spinner /></div>;
  if (query.isError || !query.data)
    return <p className="field__error">Error al cargar tasas.</p>;

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <header className="page-header">
        <div>
          <h2>Tasas de impuesto</h2>
          <p className="muted">
            La marcada como predeterminada se aplica por defecto en productos nuevos.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>Añadir tasa</Button>
      </header>

      {adding && (
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <Field label="Nombre *">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="IVA 16%" />
          </Field>
          <Field label="Tasa (%) *">
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              placeholder="16"
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
              <th>Nombre</th>
              <th>Tasa</th>
              <th>Predeterminada</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data.map((tr) => (
              <TaxRateRow
                key={tr.id}
                tr={tr}
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

function TaxRateRow({
  tr,
  companyId,
  isPlatform,
  onOk,
  onError,
}: {
  tr: TaxRate;
  companyId: string;
  isPlatform: boolean;
  onOk: (m: string) => void;
  onError: (m: string) => void;
}) {
  const update = useUpdateTaxRate(companyId, isPlatform, tr.id);

  const handleUpdate = async (patch: { name?: string; rate?: number; isDefault?: boolean; isActive?: boolean }, msg: string) => {
    try {
      await update.mutateAsync(patch);
      onOk(msg);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'No fue posible actualizar.');
    }
  };

  return (
    <tr>
      <td><strong>{tr.name}</strong></td>
      <td>{tr.rate.toFixed(2)}%</td>
      <td>
        {tr.is_default ? (
          <span className="badge">Default</span>
        ) : (
          <Button
            variant="ghost"
            onClick={() => handleUpdate({ isDefault: true }, 'Predeterminada actualizada.')}
            disabled={!tr.is_active || update.isPending}
          >
            Marcar
          </Button>
        )}
      </td>
      <td>
        <span className={`status status--${tr.is_active ? 'ok' : 'off'}`}>
          {tr.is_active ? 'Activa' : 'Inactiva'}
        </span>
      </td>
      <td>
        <Button
          variant={tr.is_active ? 'danger' : 'primary'}
          onClick={() =>
            handleUpdate(
              { isActive: !tr.is_active },
              tr.is_active ? 'Tasa desactivada.' : 'Tasa activada.',
            )
          }
          disabled={update.isPending}
        >
          {tr.is_active ? 'Desactivar' : 'Activar'}
        </Button>
      </td>
    </tr>
  );
}