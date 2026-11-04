# Autenticación — FASE 3a y FASE 3b

## Flujo de login (completo, con FASE 3b)
1. `POST /api/v1/auth/login` con `email` y `password`.
2. Si la cuenta tiene **2FA habilitado**, la API responde `401 TWO_FACTOR_REQUIRED` y el
   cliente debe reenviar el login agregando `twoFactorCode` (un código TOTP de 6 dígitos de
   la app de autenticación, o uno de los códigos de recuperación en formato `XXXX-XXXX`).
3. Si el usuario pertenece a varias empresas, la API responde `409
   COMPANY_SELECTION_REQUIRED` con la lista; el cliente reenvía el login con `companyId`.
4. El superadministrador de plataforma no tiene empresa activa (`companyId: null`).

El 2FA se revisa siempre antes que la selección de empresa: es una propiedad del usuario,
no de la empresa.

## Tokens y rotación
Sin cambios respecto a la FASE 3a: access token JWT corto en memoria, refresh token opaco
en cookie `HttpOnly`, rotación de un solo uso con detección de reutilización, bloqueo tras 5
intentos fallidos. Ver el detalle en los comentarios de `service.ts`.

## Recuperación de contraseña (FASE 3b)
- `POST /auth/forgot-password` con `{ email }`: **siempre** responde `202` con el mismo
  mensaje genérico, exista o no esa cuenta, para no revelar qué correos están registrados.
  Si existe, crea un token de un solo uso (válido `PASSWORD_RESET_TTL_MINUTES`, 60 por
  defecto) y lo envía por correo con un enlace a `FRONTEND_URL/restablecer-contrasena?token=...`.
- `POST /auth/reset-password` con `{ token, newPassword }`: valida el token, cambia la
  contraseña, **revoca todas las sesiones** (sin excepción, a diferencia del cambio de
  contraseña normal) y marca el token usado.
- Sin `RESEND_API_KEY`/`RESEND_FROM_EMAIL` configuradas, el enlace se imprime en la consola
  del servidor en vez de enviarse por correo — pensado para desarrollo local. Un fallo al
  enviar el correo se registra en consola pero no cambia la respuesta genérica al cliente.

## 2FA — TOTP (FASE 3b)
Implementación propia de RFC 6238 (TOTP) y RFC 4226 (HOTP) sobre HMAC-SHA1, sin
dependencias externas (`totp.ts`). Compatible con Google Authenticator, Authy, 1Password,
etc.

- `POST /auth/2fa/setup` (autenticado): genera un secreto nuevo y 8 códigos de recuperación
  de un solo uso. **Queda pendiente, no habilitado todavía** — así nadie se bloquea su
  propia cuenta por escanear mal el código QR. Responde `{ secret, otpAuthUrl,
  recoveryCodes }`; el frontend debe mostrar `otpAuthUrl` como código QR (o el `secret` para
  ingreso manual) y los `recoveryCodes` **una sola vez**, con aviso de guardarlos en un
  lugar seguro.
- `POST /auth/2fa/confirm` con `{ code }` (autenticado): confirma con un código real de la
  app de autenticación y recién ahí habilita el 2FA.
- `POST /auth/2fa/disable` con `{ password }` (autenticado): exige la contraseña actual y
  borra la configuración de 2FA por completo (hay que volver a configurarlo desde cero si
  se quiere reactivar).
- Un código de recuperación usado se **consume** (no vuelve a servir). No hay límite de
  intentos específico para el código de 2FA en el login; lo cubre el límite general de
  `/auth/login` (`LOGIN_RATE_LIMIT_MAX`).

**Pendiente antes de producción:** el secreto TOTP se guarda en texto plano en
`user_2fa.secret`. Queda anotado en la migración 0005 como algo a cifrar en reposo (por
ejemplo con `pgcrypto` y una clave fuera de la base de datos) antes de salir a producción.

## Una lección de la FASE 3a que se mantiene en toda la FASE 3b
Ninguna función que necesite guardar algo (un intento fallido, el consumo de un código de
recuperación, un token de restablecimiento usado) lanza su error *dentro* de la misma
transacción en la que hizo ese guardado. Primero se guarda y la transacción hace `COMMIT`
devolviendo un resultado; el error al cliente se lanza *después*, ya afuera. Lanzarlo adentro
hace que PostgreSQL deshaga también lo que se quería conservar.
