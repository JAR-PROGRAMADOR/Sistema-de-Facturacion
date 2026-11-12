import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/auth/AuthProvider';
import { ApiError } from '../../shared/api/error';
import { useToast } from '../../shared/ui/Toast';
import { Field } from '../../shared/ui/Field';
import { Input } from '../../shared/ui/Input';
import { Logo } from '../../shared/ui/Logo';

const schema = z.object({
  email: z.string().trim().email('Correo inválido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
  totp: z.string().trim().optional(),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { signIn } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    if (requiresTwoFactor && !values.totp?.trim()) {
      push('error', 'Ingresa el código de verificación.');
      return;
    }
    try {
      await signIn(values.email, values.password, values.totp || undefined);
      nav(loc.state?.from ?? '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TWO_FACTOR_REQUIRED') {
        setRequiresTwoFactor(true);
        return;
      }
      const msg =
        err instanceof Error ? err.message : 'No fue posible iniciar sesión.';
      push('error', msg);
    }
  });

  return (
    <main className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-brand">
          <Logo size={44} />
        </div>
        <h1>Iniciar sesión</h1>

        <Field label="Correo" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...register('email')} />
        </Field>

        <Field label="Contraseña" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>

        {requiresTwoFactor && (
          <>
            <p className="auth-step-hint">Esta cuenta tiene verificación en dos pasos. Ingresa el código de tu aplicación o uno de recuperación.</p>
            <Field label="Código de verificación" error={errors.totp?.message}>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                {...register('totp')}
              />
            </Field>
          </>
        )}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando…' : requiresTwoFactor ? 'Verificar código' : 'Entrar'}
        </button>

        <p className="muted" style={{ textAlign: 'center' }}>
          <Link to="/recuperar">¿Olvidaste tu contraseña?</Link>
        </p>
        <p className="auth-signup-link">
          ¿Eres nuevo? <Link to="/registro">Crear cuenta</Link>
        </p>
      </form>
    </main>
  );
}