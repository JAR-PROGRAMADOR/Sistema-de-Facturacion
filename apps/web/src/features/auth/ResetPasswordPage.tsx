import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { confirmPasswordReset } from './api';
import { Field } from '../../shared/ui/Field';
import { Input } from '../../shared/ui/Input';
import { useToast } from '../../shared/ui/Toast';

const schema = z
  .object({
    password: z
      .string()
      .min(12, 'Mínimo 12 caracteres')
      .regex(/[A-Z]/, 'Debe incluir una mayúscula')
      .regex(/[a-z]/, 'Debe incluir una minúscula')
      .regex(/[0-9]/, 'Debe incluir un dígito')
      .regex(/[^A-Za-z0-9]/, 'Debe incluir un símbolo'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Las contraseñas no coinciden',
  });

type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const { push } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (v) => {
    if (!token) {
      push('error', 'Enlace inválido.');
      return;
    }
    try {
      await confirmPasswordReset(token, v.password);
      push('success', 'Contraseña actualizada. Inicia sesión.');
      nav('/login', { replace: true });
    } catch {
      push('error', 'El enlace es inválido o expiró.');
    }
  });

  return (
    <main className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <h1>Nueva contraseña</h1>

        {!token && (
          <p role="alert" className="field__error">
            Falta el token en la URL.
          </p>
        )}

        <Field label="Nueva contraseña" error={errors.password?.message}>
          <Input
            type="password"
            autoComplete="new-password"
            autoFocus
            {...register('password')}
          />
        </Field>

        <Field label="Confirmar contraseña" error={errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...register('confirm')} />
        </Field>

        <button className="button" type="submit" disabled={isSubmitting || !token}>
          {isSubmitting ? 'Guardando…' : 'Guardar contraseña'}
        </button>

        <p className="muted" style={{ textAlign: 'center' }}>
          <Link to="/login">Volver al inicio de sesión</Link>
        </p>
      </form>
    </main>
  );
}