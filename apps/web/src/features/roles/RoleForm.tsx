import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '../../shared/auth/Button';
import { Field } from '../../shared/ui/Field';
import { Input } from '../../shared/ui/Input';
import { useToast } from '../../shared/ui/Toast';
import { ApiError } from '../../shared/api/error';
import type { Role } from '../../shared/api/types';
import { useCreateRole, useUpdateRole } from './api';

const schema = z.object({
  name: z.string().trim().min(1, 'Requerido').max(80),
  description: z.string().trim().max(200).optional(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: Role | null;
  companyId: string | null;
  isPlatform: boolean;
}

export function RoleForm({ open, onClose, initial, companyId, isPlatform }: Props) {
  const isEdit = !!initial;
  const { push } = useToast();
  const create = useCreateRole(companyId, isPlatform);
  const update = useUpdateRole(companyId, isPlatform, initial?.id ?? '');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '', description: '' } });

  useEffect(() => {
    if (!open) return;
    reset({
      name: initial?.name ?? '',
      description: initial?.description ?? '',
    });
  }, [open, initial, reset]);

  const pending = isSubmitting || create.isPending || update.isPending;

  const onSubmit = handleSubmit(async (v) => {
    const payload = {
      name: v.name.trim(),
      description: v.description?.trim() ? v.description.trim() : null,
    };
    try {
      if (isEdit) {
        await update.mutateAsync(payload);
        push('success', `Rol "${payload.name}" actualizado.`);
      } else {
        await create.mutateAsync(payload);
        push('success', `Rol "${payload.name}" creado.`);
      }
      onClose();
    } catch (err: unknown) {
      push(
        'error',
        err instanceof ApiError ? err.message : 'No fue posible guardar.',
      );
    }
  });

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <form
        className="modal card"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        noValidate
      >
        <header className="modal__header">
          <h2>{isEdit ? 'Editar rol' : 'Nuevo rol'}</h2>
        </header>

        <div className="modal__body">
          <Field label="Nombre *" error={errors.name?.message}>
            <Input autoFocus {...register('name')} />
          </Field>
          <Field label="Descripción" error={errors.description?.message}>
            <Input {...register('description')} />
          </Field>
        </div>

        <footer className="modal__footer">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear rol'}
          </Button>
        </footer>
      </form>
    </div>
  );
}