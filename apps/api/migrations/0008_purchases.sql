CREATE TABLE purchases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id    uuid NOT NULL,
  user_id        uuid NOT NULL,
  status         text NOT NULL DEFAULT 'RECIBIDA' CHECK (status IN ('RECIBIDA','ANULADA')),
  subtotal       numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_total      numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total          numeric(14,2) NOT NULL CHECK (total >= 0),
  currency       char(3) NOT NULL,
  notes          text,
  received_at    timestamptz NOT NULL DEFAULT now(),
  canceled_at    timestamptz,
  cancel_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, supplier_id) REFERENCES suppliers(company_id, id),
  CHECK (total = subtotal + tax_total),
  CHECK ((status = 'ANULADA') = (canceled_at IS NOT NULL))
);
CREATE INDEX purchases_date_idx ON purchases (company_id, received_at DESC);
CREATE INDEX purchases_supplier_idx ON purchases (company_id, supplier_id, received_at DESC);

CREATE TABLE purchase_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  purchase_id  uuid NOT NULL,
  product_id   uuid NOT NULL,
  product_sku  text NOT NULL,
  product_name text NOT NULL,
  quantity     numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost    numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  tax_rate     numeric(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  tax_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total   numeric(14,2) NOT NULL CHECK (line_total >= 0),
  FOREIGN KEY (company_id, purchase_id) REFERENCES purchases(company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, product_id) REFERENCES products(company_id, id)
);
CREATE INDEX purchase_items_purchase_idx ON purchase_items (company_id, purchase_id);

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchases
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_items
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

REVOKE UPDATE, DELETE ON purchases FROM app_user;
REVOKE UPDATE, DELETE ON purchase_items FROM app_user;
GRANT SELECT, INSERT ON purchases TO app_user;
GRANT UPDATE (status, canceled_at, cancel_reason) ON purchases TO app_user;
GRANT SELECT, INSERT ON purchase_items TO app_user;

INSERT INTO permissions (code, description) VALUES
  ('purchases.view','Ver compras recibidas'),
  ('purchases.create','Registrar recepción de compras'),
  ('purchases.cancel','Anular compras recibidas')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (company_id, role_id, permission_code)
SELECT r.company_id, r.id, p.code
  FROM roles r
 CROSS JOIN permissions p
 WHERE r.is_system = true AND r.name = 'Administrador'
   AND p.code IN ('purchases.view','purchases.create','purchases.cancel')
ON CONFLICT (role_id, permission_code) DO NOTHING;