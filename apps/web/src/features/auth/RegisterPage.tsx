import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../shared/api/client';
import { Field } from '../../shared/ui/Field';
import { Input } from '../../shared/ui/Input';
import { useToast } from '../../shared/ui/Toast';

const schema = z
  .object({
    name: z.string().trim().min(1, 'Ingresa el nombre de tu empresa.').max(120),
    fullName: z.string().trim().min(1, 'Ingresa tu nombre.').max(120),
    email: z.string().trim().email('Correo inválido.'),
    password: z.string().min(12, 'La contraseña debe tener al menos 12 caracteres.').max(128),
    passwordConfirmation: z.string(),
  })
  .refine((values) => values.password === values.passwordConfirmation, {
    message: 'Las contraseñas no coinciden.',
    path: ['passwordConfirmation'],
  });

type FormValues = z.infer<typeof schema>;
type RegisterResponse = { data: { company: { id: string; name: string }; message: string } };

export function RegisterPage() {
  const { push } = useToast();
  const [registeredCompany, setRegisteredCompany] = useState<RegisterResponse['data']['company'] | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (formValues) => {
    try {
      const response = await apiFetch<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: {
          name: formValues.name,
          fullName: formValues.fullName,
          email: formValues.email,
          password: formValues.password,
        },
        skipAuth: true,
      });
      setRegisteredCompany(response.data.company);
    } catch (error) {
      push('error', error instanceof Error ? error.message : 'No fue posible crear la cuenta.');
    }
  });

  return (
    <main className="auth-shell">
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        {registeredCompany ? (
          <>
            <h1>Cuenta creada</h1>
            <p className="auth-note">
              La empresa <strong>{registeredCompany.name}</strong> ya está registrada. Para usar el sistema,
              solicita y activa una licencia de empresa y una licencia de usuario.
            </p>
            <p className="auth-note">No se activó un período de prueba.</p>
            <Link className="auth-primary-link" to="/login">Ir a iniciar sesión</Link>
          </>
        ) : (
          <>
            <h1>Crear cuenta</h1>
            <p className="auth-note">Registra tu empresa y crea su cuenta administradora.</p>

            <Field label="Nombre de la empresa" error={errors.name?.message}>
              <Input autoComplete="organization" autoFocus {...register('name')} />
            </Field>

            <Field label="Tu nombre" error={errors.fullName?.message}>
              <Input autoComplete="name" {...register('fullName')} />
            </Field>

            <Field label="Correo" error={errors.email?.message}>
              <Input type="email" autoComplete="email" {...register('email')} />
            </Field>

            <Field label="Contraseña" error={errors.password?.message} hint="Usa al menos 12 caracteres.">
              <Input type="password" autoComplete="new-password" {...register('password')} />
            </Field>

            <Field label="Confirmar contraseña" error={errors.passwordConfirmation?.message}>
              <Input type="password" autoComplete="new-password" {...register('passwordConfirmation')} />
            </Field>

            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creando cuenta…' : 'Crear cuenta'}
            </button>
            <p className="muted" style={{ textAlign: 'center' }}>
              ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
            </p>
          </>
        )}
      </form>
    </main>
  );
}
