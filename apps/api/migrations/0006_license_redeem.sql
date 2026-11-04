-- FASE 5 · Canje de claves de licencia.
-- Las políticas RLS de `licenses` y `user_licenses` (migración 0001) solo permiten UPDATE a
-- la plataforma: es correcto para "crear/suspender/revocar", pero la empresa necesita poder
-- "canjear" su propia clave (pasar de PENDIENTE a ACTIVA) sin privilegios de plataforma.
-- Estas dos funciones SECURITY DEFINER son la única puerta controlada para eso: validan que
-- la clave (comparada por su hash) pertenezca a esa empresa/usuario y esté PENDIENTE.

CREATE FUNCTION redeem_license(p_company_id uuid, p_key_hash text)
RETURNS TABLE (id uuid, status text, starts_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_license licenses%ROWTYPE;
BEGIN
  SELECT * INTO v_license FROM licenses
   WHERE company_id = p_company_id AND key_hash = p_key_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LICENSE_NOT_FOUND';
  END IF;
  IF v_license.status <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'LICENSE_NOT_REDEEMABLE';
  END IF;

  RETURN QUERY
    UPDATE licenses l
       SET status = 'ACTIVA',
           starts_at = now(),
           expires_at = now() + make_interval(secs => v_license.duration_seconds)
     WHERE l.id = v_license.id
     RETURNING l.id, l.status, l.starts_at, l.expires_at;
END $$;

REVOKE ALL ON FUNCTION redeem_license(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_license(uuid, text) TO app_user;

CREATE FUNCTION redeem_user_license(p_company_id uuid, p_user_id uuid, p_key_hash text)
RETURNS TABLE (id uuid, status text, starts_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_license user_licenses%ROWTYPE;
BEGIN
  SELECT * INTO v_license FROM user_licenses
   WHERE company_id = p_company_id AND user_id = p_user_id AND key_hash = p_key_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LICENSE_NOT_FOUND';
  END IF;
  IF v_license.status <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'LICENSE_NOT_REDEEMABLE';
  END IF;

  RETURN QUERY
    UPDATE user_licenses ul
       SET status = 'ACTIVA',
           starts_at = now(),
           expires_at = now() + make_interval(secs => v_license.duration_seconds)
     WHERE ul.id = v_license.id
     RETURNING ul.id, ul.status, ul.starts_at, ul.expires_at;
END $$;

REVOKE ALL ON FUNCTION redeem_user_license(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_user_license(uuid, uuid, text) TO app_user;
