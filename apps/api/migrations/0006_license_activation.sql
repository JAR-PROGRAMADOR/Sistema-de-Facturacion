-- Permite canjear una licencia pendiente en su propio tenant sin conceder
-- al rol de aplicación permiso para cambiar clave, duración o cupo.
CREATE POLICY licenses_tenant_activate ON licenses FOR UPDATE
  USING (company_id = app_current_company() AND status = 'PENDIENTE')
  WITH CHECK (
    company_id = app_current_company()
    AND status = 'ACTIVA'
    AND starts_at IS NOT NULL
    AND expires_at > now()
    AND expires_at <= starts_at + duration_seconds * interval '1 second'
  );

CREATE POLICY user_licenses_owner_activate ON user_licenses FOR UPDATE
  USING (
    company_id = app_current_company()
    AND user_id = app_current_user()
    AND status = 'PENDIENTE'
  )
  WITH CHECK (
    company_id = app_current_company()
    AND user_id = app_current_user()
    AND status = 'ACTIVA'
    AND starts_at IS NOT NULL
    AND expires_at > now()
    AND expires_at <= starts_at + duration_seconds * interval '1 second'
  );

REVOKE UPDATE ON licenses, user_licenses FROM app_user;
GRANT UPDATE (status, starts_at, expires_at, updated_at) ON licenses TO app_user;
GRANT UPDATE (status, starts_at, expires_at, updated_at) ON user_licenses TO app_user;
