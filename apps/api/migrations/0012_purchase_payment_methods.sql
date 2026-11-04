ALTER TABLE purchases
  ADD COLUMN payment_method_id uuid;

ALTER TABLE purchases
  ADD CONSTRAINT purchases_payment_method_fk
  FOREIGN KEY (company_id, payment_method_id)
  REFERENCES payment_methods(company_id, id);

CREATE INDEX purchases_payment_method_idx
  ON purchases (company_id, payment_method_id)
  WHERE payment_method_id IS NOT NULL;
