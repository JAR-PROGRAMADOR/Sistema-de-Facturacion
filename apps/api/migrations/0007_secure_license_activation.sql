DROP POLICY IF EXISTS licenses_tenant_activate ON licenses;
DROP POLICY IF EXISTS user_licenses_owner_activate ON user_licenses;

REVOKE UPDATE ON licenses, user_licenses FROM app_user;
REVOKE UPDATE (status, starts_at, expires_at, updated_at) ON licenses FROM app_user;
REVOKE UPDATE (status, starts_at, expires_at, updated_at) ON user_licenses FROM app_user;

CREATE OR REPLACE FUNCTION activate_company_license(p_company_id uuid, p_key_hash text)
RETURNS TABLE (license_id uuid, license_starts_at timestamptz, license_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target licenses%ROWTYPE;
  starts_at_value timestamptz;
  expires_at_value timestamptz;
BEGIN
  IF p_company_id IS DISTINCT FROM app_current_company() OR app_is_platform() THEN
    RAISE EXCEPTION 'Contexto de empresa inválido para activar licencia';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('company-license:' || p_company_id::text, 0));
  SELECT * INTO target FROM licenses
   WHERE company_id = p_company_id AND key_hash = p_key_hash AND status = 'PENDIENTE'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT GREATEST(now(), COALESCE(max(expires_at), now())) INTO starts_at_value
    FROM licenses WHERE company_id = p_company_id AND status = 'ACTIVA' AND expires_at > now();
  expires_at_value := starts_at_value + target.duration_seconds * interval '1 second';

  UPDATE licenses SET status = 'ACTIVA', starts_at = starts_at_value, expires_at = expires_at_value
   WHERE id = target.id;
  license_id := target.id;
  license_starts_at := starts_at_value;
  license_expires_at := expires_at_value;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION activate_user_license(p_company_id uuid, p_user_id uuid, p_key_hash text)
RETURNS TABLE (license_id uuid, license_starts_at timestamptz, license_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target user_licenses%ROWTYPE;
  starts_at_value timestamptz;
  expires_at_value timestamptz;
BEGIN
  IF p_company_id IS DISTINCT FROM app_current_company()
     OR p_user_id IS DISTINCT FROM app_current_user()
     OR app_is_platform() THEN
    RAISE EXCEPTION 'Contexto de usuario inválido para activar licencia';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('user-license:' || p_company_id::text || ':' || p_user_id::text, 0));
  SELECT * INTO target FROM user_licenses
   WHERE company_id = p_company_id AND user_id = p_user_id
     AND key_hash = p_key_hash AND status = 'PENDIENTE'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT GREATEST(now(), COALESCE(max(expires_at), now())) INTO starts_at_value
    FROM user_licenses
   WHERE company_id = p_company_id AND user_id = p_user_id
     AND status = 'ACTIVA' AND expires_at > now();
  expires_at_value := starts_at_value + target.duration_seconds * interval '1 second';

  UPDATE user_licenses SET status = 'ACTIVA', starts_at = starts_at_value, expires_at = expires_at_value
   WHERE id = target.id;
  license_id := target.id;
  license_starts_at := starts_at_value;
  license_expires_at := expires_at_value;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION activate_company_license(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION activate_user_license(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_company_license(uuid, text) TO app_user;
GRANT EXECUTE ON FUNCTION activate_user_license(uuid, uuid, text) TO app_user;