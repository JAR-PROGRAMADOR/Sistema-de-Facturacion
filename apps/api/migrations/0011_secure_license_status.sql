-- FASE 5 · Cambio de estado de licencias desde la plataforma.
-- Las actualizaciones directas sobre `licenses` quedaron restringidas por seguridad para
-- evitar que la aplicación pueda alterar claves o cupos. La plataforma debe usar una
-- función SECURITY DEFINER controlada, que se ejecuta con privilegios del propietario.

CREATE OR REPLACE FUNCTION set_license_status(p_license_id uuid, p_status text)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  status text,
  duration_seconds bigint,
  max_users integer,
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_license licenses%ROWTYPE;
BEGIN
  SELECT * INTO v_license
    FROM licenses l
   WHERE l.id = p_license_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LICENSE_NOT_FOUND';
  END IF;

  IF p_status NOT IN ('ACTIVA', 'SUSPENDIDA', 'REVOCADA') THEN
    RAISE EXCEPTION 'INVALID_LICENSE_STATUS';
  END IF;

  RETURN QUERY
    UPDATE licenses l
       SET status = p_status,
           updated_at = now()
     WHERE l.id = p_license_id
     RETURNING
       l.id,
       l.company_id,
       l.status,
       l.duration_seconds,
       l.max_users,
       l.starts_at,
       l.expires_at,
       l.created_at;
END $$;

REVOKE ALL ON FUNCTION set_license_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_license_status(uuid, text) TO app_user;

CREATE OR REPLACE FUNCTION set_user_license_status(p_user_license_id uuid, p_status text)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  user_id uuid,
  status text,
  duration_seconds bigint,
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_license user_licenses%ROWTYPE;
BEGIN
  SELECT * INTO v_license
    FROM user_licenses ul
   WHERE ul.id = p_user_license_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_LICENSE_NOT_FOUND';
  END IF;

  IF p_status NOT IN ('ACTIVA', 'SUSPENDIDA', 'REVOCADA') THEN
    RAISE EXCEPTION 'INVALID_USER_LICENSE_STATUS';
  END IF;

  RETURN QUERY
    UPDATE user_licenses ul
       SET status = p_status,
           updated_at = now()
     WHERE ul.id = p_user_license_id
     RETURNING
       ul.id,
       ul.company_id,
       ul.user_id,
       ul.status,
       ul.duration_seconds,
       ul.starts_at,
       ul.expires_at,
       ul.created_at;
END $$;

REVOKE ALL ON FUNCTION set_user_license_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_user_license_status(uuid, text) TO app_user;
