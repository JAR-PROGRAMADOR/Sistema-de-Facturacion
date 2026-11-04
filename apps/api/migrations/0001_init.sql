-- FASE 2 · Esquema inicial multiempresa.
-- Reglas del diseño:
--  * Toda tabla de negocio tiene company_id y RLS (política tenant_isolation).
--  * Las claves foráneas entre tablas de negocio son compuestas (company_id, id): una fila
--    de la empresa A no puede apuntar a una fila de la empresa B.
--  * El rol de la aplicación (app_user) NO es dueño de las tablas ni tiene BYPASSRLS,
--    por eso las políticas sí le aplican. Las migraciones corren con el rol dueño.
--  * Contexto por transacción: app.company_id, app.user_id, app.is_platform.

-- ---------------------------------------------------------------- funciones de contexto
CREATE FUNCTION app_current_company() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_is_platform() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.is_platform', true), '') = 'true' $$;

CREATE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ---------------------------------------------------------------- tablas globales
CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  legal_name  text,
  tax_id      text,
  country     char(2),
  currency    char(3) NOT NULL DEFAULT 'USD',
  locale      text NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en','tr','zh-CN','ja','ko')),
  timezone    text NOT NULL DEFAULT 'UTC',
  status      text NOT NULL DEFAULT 'ACTIVA' CHECK (status IN ('ACTIVA','SUSPENDIDA')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL,
  password_hash         text NOT NULL,
  full_name             text NOT NULL,
  locale                text NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en','tr','zh-CN','ja','ko')),
  is_platform_admin     boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'ACTIVO' CHECK (status IN ('ACTIVO','BLOQUEADO','INACTIVO')),
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE permissions (
  code        text PRIMARY KEY,
  description text NOT NULL
);

-- ---------------------------------------------------------------- identidad por empresa
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, name)
);

CREATE TABLE role_permissions (
  company_id      uuid NOT NULL,
  role_id         uuid NOT NULL,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code),
  FOREIGN KEY (company_id, role_id) REFERENCES roles(company_id, id) ON DELETE CASCADE
);

CREATE TABLE company_users (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    uuid NOT NULL,
  status     text NOT NULL DEFAULT 'ACTIVO' CHECK (status IN ('ACTIVO','INACTIVO')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, role_id),
  FOREIGN KEY (company_id, role_id) REFERENCES roles(company_id, id)
);
CREATE INDEX company_users_user_idx ON company_users (company_id, user_id);
CREATE INDEX company_users_role_idx ON company_users (company_id, role_id);

-- ---------------------------------------------------------------- licencias
-- El estado VENCIDA se calcula por expires_at; el estado guardado cubre PENDIENTE, ACTIVA,
-- SUSPENDIDA y REVOCADA (y VENCIDA si algún proceso la persiste).
CREATE TABLE licenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key_hash         text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'PENDIENTE'
                   CHECK (status IN ('PENDIENTE','ACTIVA','VENCIDA','SUSPENDIDA','REVOCADA')),
  duration_seconds bigint NOT NULL CHECK (duration_seconds > 0),
  max_users        integer NOT NULL DEFAULT 1 CHECK (max_users > 0),
  starts_at        timestamptz,
  expires_at       timestamptz,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ACTIVA' OR (starts_at IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX licenses_company_idx ON licenses (company_id, status);

CREATE TABLE user_licenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  user_id          uuid NOT NULL,
  key_hash         text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'PENDIENTE'
                   CHECK (status IN ('PENDIENTE','ACTIVA','VENCIDA','SUSPENDIDA','REVOCADA')),
  duration_seconds bigint NOT NULL CHECK (duration_seconds > 0),
  starts_at        timestamptz,
  expires_at       timestamptz,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ACTIVA' OR (starts_at IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX user_licenses_user_idx ON user_licenses (company_id, user_id, status);

-- ---------------------------------------------------------------- catálogo
CREATE TABLE tax_rates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  rate       numeric(7,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  is_default boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, id),
  UNIQUE (company_id, name)
);
CREATE UNIQUE INDEX tax_rates_one_default ON tax_rates (company_id) WHERE is_default;

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX categories_name_unique ON categories (company_id, lower(name));

CREATE TABLE products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id uuid,
  tax_rate_id uuid,
  sku         text NOT NULL,
  barcode     text,
  name        text NOT NULL,
  description text,
  type        text NOT NULL DEFAULT 'BIEN' CHECK (type IN ('BIEN','SERVICIO')),
  price       numeric(14,2) NOT NULL CHECK (price >= 0),
  cost        numeric(14,2) CHECK (cost >= 0),
  track_stock boolean NOT NULL DEFAULT true,
  min_stock   numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  is_active   boolean NOT NULL DEFAULT true,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, category_id) REFERENCES categories(company_id, id),
  FOREIGN KEY (company_id, tax_rate_id) REFERENCES tax_rates(company_id, id),
  CHECK (type = 'BIEN' OR track_stock = false)
);
CREATE UNIQUE INDEX products_sku_unique ON products (company_id, lower(sku)) WHERE deleted_at IS NULL;
CREATE INDEX products_name_idx ON products (company_id, lower(name));
CREATE INDEX products_barcode_idx ON products (company_id, barcode) WHERE barcode IS NOT NULL;

CREATE TABLE suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  tax_id     text,
  email      text,
  phone      text,
  address    text,
  notes      text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);

CREATE TABLE product_suppliers (
  company_id   uuid NOT NULL,
  product_id   uuid NOT NULL,
  supplier_id  uuid NOT NULL,
  supplier_sku text,
  cost         numeric(14,2) CHECK (cost >= 0),
  PRIMARY KEY (product_id, supplier_id),
  FOREIGN KEY (company_id, product_id)  REFERENCES products(company_id, id)  ON DELETE CASCADE,
  FOREIGN KEY (company_id, supplier_id) REFERENCES suppliers(company_id, id) ON DELETE CASCADE
);

CREATE TABLE customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  tax_id     text,
  email      text,
  phone      text,
  address    text,
  notes      text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE INDEX customers_name_idx ON customers (company_id, lower(name));

-- ---------------------------------------------------------------- inventario
CREATE TABLE inventory_stock (
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity   numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id),
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id) ON DELETE CASCADE
);

-- Solo inserción: quantity es el cambio con signo (+ entrada, - salida).
CREATE TABLE inventory_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  product_id     uuid NOT NULL,
  type           text NOT NULL CHECK (type IN ('ENTRADA','SALIDA','AJUSTE')),
  quantity       numeric(14,3) NOT NULL CHECK (quantity <> 0),
  stock_after    numeric(14,3) NOT NULL CHECK (stock_after >= 0),
  reason         text,
  reference_type text,
  reference_id   uuid,
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id) ON DELETE CASCADE
);
CREATE INDEX inventory_movements_product_idx ON inventory_movements (company_id, product_id, created_at DESC);

-- ---------------------------------------------------------------- caja y pagos
CREATE TABLE payment_methods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);

CREATE TABLE cash_sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opened_by               uuid NOT NULL,
  opened_at               timestamptz NOT NULL DEFAULT now(),
  opening_amount          numeric(14,2) NOT NULL CHECK (opening_amount >= 0),
  closed_by               uuid,
  closed_at               timestamptz,
  closing_amount_declared numeric(14,2) CHECK (closing_amount_declared >= 0),
  closing_amount_expected numeric(14,2),
  status                  text NOT NULL DEFAULT 'ABIERTA' CHECK (status IN ('ABIERTA','CERRADA')),
  UNIQUE (company_id, id),
  CHECK ((status = 'CERRADA') = (closed_at IS NOT NULL))
);
-- Un cajero solo puede tener un turno abierto a la vez.
CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions (company_id, opened_by) WHERE status = 'ABIERTA';

CREATE TABLE cash_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cash_session_id uuid NOT NULL,
  type            text NOT NULL CHECK (type IN ('INGRESO','EGRESO')),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  reason          text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, cash_session_id) REFERENCES cash_sessions(company_id, id)
);

-- ---------------------------------------------------------------- ventas
CREATE TABLE sales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cash_session_id uuid,
  customer_id     uuid,
  user_id         uuid NOT NULL,
  status          text NOT NULL DEFAULT 'COMPLETADA' CHECK (status IN ('COMPLETADA','CANCELADA')),
  subtotal        numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount_total  numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total           numeric(14,2) NOT NULL CHECK (total >= 0),
  currency        char(3) NOT NULL,
  notes           text,
  sold_at         timestamptz NOT NULL DEFAULT now(),
  canceled_at     timestamptz,
  canceled_by     uuid,
  cancel_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, cash_session_id) REFERENCES cash_sessions(company_id, id),
  FOREIGN KEY (company_id, customer_id)     REFERENCES customers(company_id, id),
  CHECK (total = subtotal - discount_total + tax_total),
  CHECK ((status = 'CANCELADA') = (canceled_at IS NOT NULL))
);
CREATE INDEX sales_date_idx ON sales (company_id, sold_at DESC);
CREATE INDEX sales_customer_idx ON sales (company_id, customer_id) WHERE customer_id IS NOT NULL;

-- Precios, nombre e impuesto se congelan en la línea para poder reconstruir la venta.
CREATE TABLE sale_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  sale_id      uuid NOT NULL,
  product_id   uuid NOT NULL,
  product_sku  text NOT NULL,
  product_name text NOT NULL,
  quantity     numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price   numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  discount     numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate     numeric(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  tax_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total   numeric(14,2) NOT NULL CHECK (line_total >= 0),
  FOREIGN KEY (company_id, sale_id)    REFERENCES sales(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id)
);
CREATE INDEX sale_items_sale_idx ON sale_items (company_id, sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (company_id, product_id);

CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sale_id           uuid NOT NULL,
  payment_method_id uuid NOT NULL,
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  reference         text,
  paid_at           timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  FOREIGN KEY (company_id, sale_id)           REFERENCES sales(company_id, id),
  FOREIGN KEY (company_id, payment_method_id) REFERENCES payment_methods(company_id, id)
);
CREATE INDEX payments_sale_idx ON payments (company_id, sale_id);

-- ---------------------------------------------------------------- facturación
CREATE TABLE invoice_series (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        text NOT NULL,
  prefix      text NOT NULL DEFAULT '',
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  is_default  boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, id),
  UNIQUE (company_id, code)
);
CREATE UNIQUE INDEX invoice_series_one_default ON invoice_series (company_id) WHERE is_default;

CREATE TABLE invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sale_id          uuid NOT NULL,
  series_id        uuid NOT NULL,
  number           bigint NOT NULL,
  full_number      text NOT NULL,
  customer_id      uuid,
  customer_name    text,
  customer_tax_id  text,
  customer_address text,
  status           text NOT NULL DEFAULT 'EMITIDA' CHECK (status IN ('EMITIDA','ANULADA')),
  subtotal         numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount_total   numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total        numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total            numeric(14,2) NOT NULL CHECK (total >= 0),
  currency         char(3) NOT NULL,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  canceled_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, series_id, number),
  UNIQUE (company_id, sale_id),
  FOREIGN KEY (company_id, sale_id)     REFERENCES sales(company_id, id),
  FOREIGN KEY (company_id, series_id)   REFERENCES invoice_series(company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers(company_id, id),
  CHECK (total = subtotal - discount_total + tax_total),
  CHECK ((status = 'ANULADA') = (canceled_at IS NOT NULL))
);
CREATE INDEX invoices_date_idx ON invoices (company_id, issued_at DESC);

CREATE TABLE invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  invoice_id  uuid NOT NULL,
  product_id  uuid,
  description text NOT NULL,
  quantity    numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price  numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  discount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate    numeric(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  tax_amount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total  numeric(14,2) NOT NULL CHECK (line_total >= 0),
  FOREIGN KEY (company_id, invoice_id) REFERENCES invoices(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id)
);
CREATE INDEX invoice_items_invoice_idx ON invoice_items (company_id, invoice_id);

-- Numeración sin saltos: se llama dentro de la misma transacción que crea la factura.
-- El UPDATE bloquea la fila de la serie hasta el COMMIT. Si la transacción falla, el
-- número no se consume.
CREATE FUNCTION next_invoice_number(p_series uuid) RETURNS bigint
  LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  UPDATE invoice_series SET next_number = next_number + 1
   WHERE id = p_series
   RETURNING next_number - 1 INTO n;
  IF n IS NULL THEN
    RAISE EXCEPTION 'Serie de facturación no encontrada';
  END IF;
  RETURN n;
END $$;

-- ---------------------------------------------------------------- soporte
CREATE TABLE company_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key          text NOT NULL,
  request_hash text NOT NULL,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

-- Solo inserción. company_id puede ser NULL para eventos previos a elegir empresa (login).
CREATE TABLE audit_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    uuid REFERENCES companies(id) ON DELETE SET NULL,
  user_id       uuid,
  action        text NOT NULL,
  resource_type text,
  resource_id   text,
  result        text NOT NULL DEFAULT 'OK' CHECK (result IN ('OK','ERROR')),
  ip            text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_company_idx ON audit_logs (company_id, created_at DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, created_at DESC);

-- ---------------------------------------------------------------- updated_at automático
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','users','licenses','user_licenses','categories',
                           'products','suppliers','customers','company_settings'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t || '_updated_at', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- RLS: tablas de negocio
-- Solo ve y escribe filas de la empresa fijada en app.company_id. Sin contexto: cero filas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles','role_permissions','company_users','tax_rates','categories',
      'products','suppliers','product_suppliers','customers','inventory_stock','inventory_movements',
      'payment_methods','cash_sessions','cash_movements','sales','sale_items','payments',
      'invoice_series','invoices','invoice_items','company_settings','idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                      USING (company_id = app_current_company())
                      WITH CHECK (company_id = app_current_company())', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- RLS: tablas especiales
-- companies: la empresa se ve a sí misma; solo la plataforma crea, edita o borra.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY companies_select ON companies FOR SELECT
  USING (id = app_current_company() OR app_is_platform());
CREATE POLICY companies_insert ON companies FOR INSERT WITH CHECK (app_is_platform());
CREATE POLICY companies_update ON companies FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());
CREATE POLICY companies_delete ON companies FOR DELETE USING (app_is_platform());

-- licencias: la empresa consulta las suyas; solo la plataforma las crea o cambia.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['licenses','user_licenses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (company_id = app_current_company() OR app_is_platform())', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (app_is_platform())', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform())', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (app_is_platform())', t || '_delete', t);
  END LOOP;
END $$;

-- users: identidad global. Se ve a sí mismo, a los miembros de la empresa en contexto, o todo
-- si es la plataforma. Para crear un usuario dentro de una empresa, la aplicación genera el
-- UUID y NO usa RETURNING (la fila aún no es visible hasta crear su company_users).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select ON users FOR SELECT USING (
  app_is_platform() OR id = app_current_user()
  OR EXISTS (SELECT 1 FROM company_users cu
              WHERE cu.user_id = users.id AND cu.company_id = app_current_company()));
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (app_is_platform() OR app_current_company() IS NOT NULL);
CREATE POLICY users_update ON users FOR UPDATE
  USING (app_is_platform() OR id = app_current_user()
         OR EXISTS (SELECT 1 FROM company_users cu
                     WHERE cu.user_id = users.id AND cu.company_id = app_current_company()))
  WITH CHECK (true);
CREATE POLICY users_delete ON users FOR DELETE USING (app_is_platform());

-- audit_logs: solo inserción. Lectura de la propia empresa o de la plataforma.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_select ON audit_logs FOR SELECT
  USING (company_id = app_current_company() OR app_is_platform());
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (company_id IS NOT DISTINCT FROM app_current_company() OR app_is_platform());

-- ---------------------------------------------------------------- funciones de autenticación
-- Se ejecutan como el dueño (saltan RLS) y devuelven solo lo estrictamente necesario.
CREATE FUNCTION auth_get_user_by_email(p_email text)
RETURNS TABLE (id uuid, email text, password_hash text, full_name text, locale text, status text,
               failed_login_attempts integer, locked_until timestamptz, is_platform_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.email, u.password_hash, u.full_name, u.locale, u.status,
         u.failed_login_attempts, u.locked_until, u.is_platform_admin
    FROM users u WHERE lower(u.email) = lower(p_email)
$$;

CREATE FUNCTION auth_list_memberships(p_user uuid)
RETURNS TABLE (company_id uuid, company_name text, role_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cu.company_id, c.name, cu.role_id
    FROM company_users cu JOIN companies c ON c.id = cu.company_id
   WHERE cu.user_id = p_user AND cu.status = 'ACTIVO' AND c.status = 'ACTIVA'
$$;

REVOKE ALL ON FUNCTION auth_get_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_list_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_get_user_by_email(text) TO app_user;
GRANT EXECUTE ON FUNCTION auth_list_memberships(uuid) TO app_user;

-- ---------------------------------------------------------------- privilegios de app_user
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- Tablas de solo inserción (trazabilidad).
REVOKE UPDATE, DELETE ON inventory_movements, audit_logs FROM app_user;
-- Catálogo global y control de migraciones: la aplicación no los modifica.
REVOKE INSERT, UPDATE, DELETE ON permissions FROM app_user;
REVOKE ALL ON schema_migrations FROM app_user;
-- users: columnas que la aplicación puede escribir. is_platform_admin queda fuera a propósito.
REVOKE INSERT, UPDATE ON users FROM app_user;
GRANT INSERT (id, email, password_hash, full_name, locale, status) ON users TO app_user;
GRANT UPDATE (email, password_hash, full_name, locale, status, failed_login_attempts,
              locked_until, last_login_at) ON users TO app_user;
