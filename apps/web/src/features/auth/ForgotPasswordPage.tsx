import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Field } from '../../shared/ui/Field';
import { Input } from '../../shared/ui/Input';
import { useToast } from '../../shared/ui/Toast';

const schema = z.object({ email: z.string().trim().email('Correo inválido') });
type FormValues = z.infer<typeof schema>;

async function requestPasswordReset(email: string) {
  const response = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error('No fue posible procesar la solicitud.');
  }
}

export function ForgotPasswordPage() {
  const { push } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await requestPasswordReset(v.email);
      // La respuesta es siempre la misma por diseño (no revela si el correo existe).
    } catch {
      push('error', 'No fue posible procesar la solicitud.');
    }
  });

  return (
    <main className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <h1>Recuperar contraseña</h1>

        {isSubmitSuccessful ? (
          <p>
            Si el correo está registrado, recibirás un enlace para restablecer tu
            contraseña.
          </p>
        ) : (
          <>
            <Field label="Correo" error={errors.email?.message}>
              <Input type="email" autoComplete="email" autoFocus {...register('email')} />
            </Field>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Enviando…' : 'Enviar enlace'}
            </button>
          </>
        )}

        <p className="muted" style={{ textAlign: 'center' }}>
          <Link to="/login">Volver al inicio de sesión</Link>
        </p>
      </form>
    </main>
  );
}