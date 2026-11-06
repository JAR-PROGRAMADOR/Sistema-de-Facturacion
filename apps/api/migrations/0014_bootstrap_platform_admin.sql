-- FASE 5 · Arranque del primer superadministrador de plataforma.
--
-- Problema que resuelve: sin superadministrador no hay nadie que emita claves de
-- licencia, y sin clave ninguna empresa puede entrar: la app queda bloqueada en la
-- pantalla de activación. El rol app_user NO puede escribir users.is_platform_admin
-- (las concesiones de columna de la migración 0001 lo dejan fuera a propósito), así
-- que el arranque tiene que pasar por esta función SECURITY DEFINER, propiedad del
-- dueño del esquema, igual que redeem_license / redeem_user_license.
--
-- La API la llama al arrancar SOLO si están definidas PLATFORM_ADMIN_EMAIL y
-- PLATFORM_ADMIN_PASSWORD (ver apps/api/src/modules/auth/bootstrap.ts). La
-- contraseña llega ya con hash Argon2 desde la API; aquí nunca se ve en claro.
-- Si el usuario ya existe, solo se le da el rol de plataforma y se conserva su
-- contraseña actual. Si no existe, se crea como superadministrador activo.
-- No se toca nada si ya existe un superadministrador con ese correo.

CREATE FUNCTION ensure_platform_admin(p_email text, p_password_hash text)
RETURNS TABLE (user_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user users%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_EMAIL_REQUIRED';
  END IF;
  IF p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_PASSWORD_REQUIRED';
  END IF;

  SELECT * INTO v_user FROM users WHERE lower(email) = lower(p_email) FOR UPDATE;

  IF FOUND THEN
    UPDATE users SET is_platform_admin = true WHERE id = v_user.id;
    RETURN QUERY SELECT v_user.id, false;
    RETURN;
  END IF;

  INSERT INTO users (email, password_hash, full_name, locale, status, is_platform_admin)
  VALUES (lower(p_email), p_password_hash, 'Administrador de plataforma', 'es', 'ACTIVO', true)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, true;
END $$;

REVOKE ALL ON FUNCTION ensure_platform_admin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_platform_admin(text, text) TO app_user;
