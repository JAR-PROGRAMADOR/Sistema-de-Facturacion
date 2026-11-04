ALTER TABLE payments ADD CONSTRAINT payments_company_id_id_unique UNIQUE (company_id, id);

CREATE TABLE payment_refunds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  sale_id     uuid NOT NULL,
  payment_id  uuid NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  reference   text,
  reason      text NOT NULL,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, payment_id),
  FOREIGN KEY (company_id, sale_id) REFERENCES sales(company_id, id),
  FOREIGN KEY (company_id, payment_id) REFERENCES payments(company_id, id)
);
CREATE INDEX payment_refunds_sale_idx ON payment_refunds (company_id, sale_id, created_at DESC);

ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_refunds
  USING (company_id = app_current_company())
  WITH CHECK (company_id = app_current_company());

GRANT SELECT, INSERT ON payment_refunds TO app_user;
REVOKE UPDATE, DELETE ON payment_refunds FROM app_user;