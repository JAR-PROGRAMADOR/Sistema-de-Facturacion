CREATE TABLE registration_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDIENTE'
    CHECK (status IN ('PENDIENTE', 'CANJEADA', 'REVOCADA')),
  duration_seconds bigint NOT NULL CHECK (duration_seconds > 0),
  max_users integer NOT NULL CHECK (max_users > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  redeemed_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  redeemed_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status <> 'CANJEADA' OR (redeemed_at IS NOT NULL AND redeemed_company_id IS NOT NULL AND redeemed_user_id IS NOT NULL))
);

ALTER TABLE registration_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY registration_licenses_platform_select ON registration_licenses
  FOR SELECT USING (app_is_platform());
CREATE POLICY registration_licenses_platform_insert ON registration_licenses
  FOR INSERT WITH CHECK (app_is_platform());
CREATE POLICY registration_licenses_platform_update ON registration_licenses
  FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());
CREATE POLICY registration_licenses_platform_delete ON registration_licenses
  FOR DELETE USING (app_is_platform());
GRANT SELECT, INSERT, UPDATE, DELETE ON registration_licenses TO app_user;

CREATE FUNCTION redeem_registration_license(p_key_hash text, p_company_id uuid, p_user_id uuid)
RETURNS TABLE (registration_license_id uuid, company_license_id uuid, user_license_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target registration_licenses%ROWTYPE;
  license_starts_at timestamptz;
  license_expires_at timestamptz;
  new_company_license_id uuid;
  new_user_license_id uuid;
BEGIN
  IF NOT app_is_platform()
     OR p_company_id IS DISTINCT FROM app_current_company()
     OR p_user_id IS DISTINCT FROM app_current_user() THEN
    RAISE EXCEPTION 'REGISTRATION_LICENSE_CONTEXT_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM company_users
     WHERE company_id = p_company_id AND user_id = p_user_id AND status = 'ACTIVO'
  ) THEN
    RAISE EXCEPTION 'REGISTRATION_LICENSE_CONTEXT_INVALID';
  END IF;

  SELECT * INTO target FROM registration_licenses
   WHERE key_hash = p_key_hash
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REGISTRATION_LICENSE_NOT_FOUND';
  END IF;
  IF target.status <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'REGISTRATION_LICENSE_NOT_REDEEMABLE';
  END IF;

  license_starts_at := now();
  license_expires_at := license_starts_at + target.duration_seconds * interval '1 second';

  INSERT INTO licenses (
    company_id, key_hash, status, duration_seconds, max_users, starts_at, expires_at, created_by
  ) VALUES (
    p_company_id, 'registration-company:' || gen_random_uuid()::text, 'ACTIVA',
    target.duration_seconds, target.max_users, license_starts_at, license_expires_at, target.created_by
  ) RETURNING id INTO new_company_license_id;

  INSERT INTO user_licenses (
    company_id, user_id, key_hash, status, duration_seconds, starts_at, expires_at, created_by
  ) VALUES (
    p_company_id, p_user_id, 'registration-user:' || gen_random_uuid()::text, 'ACTIVA',
    target.duration_seconds, license_starts_at, license_expires_at, target.created_by
  ) RETURNING id INTO new_user_license_id;

  UPDATE registration_licenses
     SET status = 'CANJEADA',
         redeemed_at = license_starts_at,
         redeemed_company_id = p_company_id,
         redeemed_user_id = p_user_id
   WHERE id = target.id;

  registration_license_id := target.id;
  company_license_id := new_company_license_id;
  user_license_id := new_user_license_id;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION redeem_registration_license(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_registration_license(text, uuid, uuid) TO app_user;