-- FASE 3a · Corrección: función dedicada para bloquear la fila del usuario durante el
-- login ANTES de conocer su empresa. La consulta directa a la tabla `users` no sirve aquí
-- porque sus políticas RLS exigen una empresa activa en el contexto, y durante el login
-- todavía no la tenemos. SECURITY DEFINER permite bloquear la fila (FOR UPDATE) saltando
-- esa restricción, igual que ya hacía auth_get_user_by_email con la lectura simple.
CREATE FUNCTION auth_get_user_for_login(p_email text)
RETURNS TABLE (id uuid, email text, password_hash text, full_name text, locale text, status text,
               failed_login_attempts integer, locked_until timestamptz, is_platform_admin boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email, u.password_hash, u.full_name, u.locale, u.status,
         u.failed_login_attempts, u.locked_until, u.is_platform_admin
    FROM users u
   WHERE lower(u.email) = lower(p_email)
   FOR UPDATE
$$;

REVOKE ALL ON FUNCTION auth_get_user_for_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_get_user_for_login(text) TO app_user;
