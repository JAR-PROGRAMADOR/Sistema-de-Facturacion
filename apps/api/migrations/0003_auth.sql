-- FASE 3a · Sesiones (refresh tokens con rotación).
-- Solo se guarda el HASH (SHA-256) del token; el token real vive únicamente en la cookie del usuario.
-- Esta tabla no tiene RLS: no es dato de negocio y se consulta por hash antes de conocer
-- la empresa. Solo la lee y escribe el módulo de autenticación.
CREATE TABLE sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         uuid NOT NULL,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id        uuid REFERENCES companies(id) ON DELETE CASCADE,
  token_hash        text NOT NULL UNIQUE,
  family_started_at timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  revoked_at        timestamptz,
  user_agent        text,
  ip                text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_family_idx ON sessions (family_id);
CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);
