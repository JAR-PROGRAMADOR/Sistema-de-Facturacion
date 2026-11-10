-- user_licenses.company_id y user_id no tenían llave foránea (migración 0001):
-- borrar un usuario o una empresa dejaba filas ACTIVA huérfanas apuntando a
-- registros que ya no existen. Primero se eliminan esas huérfanas y luego se
-- crean las llaves con CASCADE, igual que licenses.company_id.
DELETE FROM user_licenses
WHERE user_id NOT IN (SELECT id FROM users)
   OR company_id NOT IN (SELECT id FROM companies);

ALTER TABLE user_licenses
  ADD CONSTRAINT user_licenses_company_id_fk
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  ADD CONSTRAINT user_licenses_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
