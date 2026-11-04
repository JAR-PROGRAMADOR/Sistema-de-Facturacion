-- FASE 3b · Recuperación de contraseña y 2FA (TOTP).
-- Igual que `sessions`, estas tablas NO tienen RLS: se consultan por token/usuario antes
-- de conocer la empresa (recuperación de contraseña) o están ligadas 1 a 1 con `users`
-- (2FA), y el control de acceso lo hace la capa de aplicación, no la base de datos.

CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);

-- NOTA DE SEGURIDAD: `secret` queda en texto plano por ahora. Antes de producción hay que
-- cifrarlo en reposo (por ejemplo con pgcrypto y una clave fuera de la base de datos); queda
-- anotado como pendiente explícito, no es un descuido.
CREATE TABLE user_2fa (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret              text NOT NULL,
  enabled             boolean NOT NULL DEFAULT false,
  confirmed_at        timestamptz,
  recovery_codes_hash text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_2fa_updated_at BEFORE UPDATE ON user_2fa
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
