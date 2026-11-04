REVOKE UPDATE, DELETE ON purchases FROM app_user;
REVOKE UPDATE (status, canceled_at, cancel_reason) ON purchases FROM app_user;
GRANT UPDATE (status, canceled_at, cancel_reason) ON purchases TO app_user;
REVOKE UPDATE, DELETE ON purchase_items FROM app_user;