import type { Env } from '../../config/env.js';

/**
 * Envía el correo de recuperación de contraseña vía Resend (https://resend.com).
 * Si no hay API key configurada (por ejemplo en desarrollo local sin cuenta de Resend),
 * no falla: registra el enlace en la consola para poder probar el flujo sin enviar correos
 * reales. En producción, RESEND_API_KEY y RESEND_FROM_EMAIL son obligatorias para esta
 * función (se valida al llamarla, no al arrancar, porque no todas las instalaciones usan
 * recuperación de contraseña desde el primer día).
 */
export async function sendPasswordResetEmail(env: Env, to: string, resetUrl: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    console.warn(
      `[correo] RESEND_API_KEY/RESEND_FROM_EMAIL no configuradas. Enlace de recuperación para ${to}: ${resetUrl}`,
    );
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to,
      subject: 'Recupera tu contraseña',
      html: `
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${resetUrl}">Haz clic aquí para elegir una nueva contraseña</a>.</p>
        <p>Si tú no pediste esto, puedes ignorar este correo; tu contraseña actual sigue siendo válida.</p>
        <p>Este enlace vence en ${env.PASSWORD_RESET_TTL_MINUTES} minutos.</p>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend respondió ${res.status} al enviar el correo de recuperación: ${body}`);
  }
}
