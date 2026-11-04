-- Catálogo global de permisos. Los roles de cada empresa se crean al dar de alta la empresa.
INSERT INTO permissions (code, description) VALUES
  ('users.view','Ver usuarios'), ('users.create','Crear usuarios'), ('users.edit','Editar usuarios'), ('users.delete','Desactivar usuarios'),
  ('roles.view','Ver roles'), ('roles.manage','Gestionar roles y permisos'),
  ('products.view','Ver productos'), ('products.create','Crear productos'), ('products.edit','Editar productos'), ('products.delete','Eliminar productos'),
  ('categories.view','Ver categorías'), ('categories.manage','Gestionar categorías'),
  ('suppliers.view','Ver proveedores'), ('suppliers.manage','Gestionar proveedores'),
  ('customers.view','Ver clientes'), ('customers.create','Crear clientes'), ('customers.edit','Editar clientes'), ('customers.delete','Desactivar clientes'),
  ('inventory.view','Ver inventario'), ('inventory.adjust','Ajustar inventario'),
  ('pos.use','Usar el punto de venta'),
  ('cash.view','Ver turnos de caja'), ('cash.open','Abrir caja'), ('cash.close','Cerrar caja'),
  ('sales.view','Ver ventas'), ('sales.create','Registrar ventas'), ('sales.cancel','Cancelar ventas'),
  ('invoices.view','Ver facturas'), ('invoices.create','Crear facturas'), ('invoices.cancel','Anular facturas'),
  ('payments.view','Ver pagos'), ('payments.create','Registrar pagos'),
  ('reports.view','Ver reportes'),
  ('settings.view','Ver configuración'), ('settings.edit','Editar configuración'),
  ('audit.view','Ver auditoría'), ('licenses.view','Ver licencias de la empresa')
ON CONFLICT (code) DO NOTHING;
