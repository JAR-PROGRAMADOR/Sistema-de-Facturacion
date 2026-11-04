# Base de datos (FASE 2)

Fuente de verdad: los archivos SQL de `apps/api/migrations/`. Se aplican en orden con `npm run db:migrate`
y quedan registrados en `schema_migrations`. Las tablas de TypeScript (Drizzle) se generarán desde la base
real (`drizzle-kit pull`) cuando los módulos empiecen a consultarla.

## Dos roles de base de datos
| Rol | Quién lo usa | Notas |
|---|---|---|
| Dueño (`DATABASE_ADMIN_URL`) | Migraciones y pruebas | Dueño de las tablas; ignora RLS. La API nunca lo usa. |
| `app_user` (`DATABASE_URL`) | La API | Sin BYPASSRLS ni superusuario. Las políticas RLS le aplican siempre. |

## Contexto por transacción
`withContext(pool, { companyId, userId, platform }, fn)` abre una transacción y fija `app.company_id`,
`app.user_id` y `app.is_platform`. Las políticas RLS leen esos valores. Sin contexto no se ve ninguna fila.

## Reglas que la base garantiza
- Toda tabla de negocio tiene `company_id` y política `tenant_isolation`.
- Claves foráneas compuestas `(company_id, id)`: no se pueden mezclar filas de empresas distintas.
- `inventory_movements` y `audit_logs` son de solo inserción para `app_user`.
- `app_user` no puede escribir `users.is_platform_admin`; solo la plataforma (rol dueño) lo asigna.
- Solo la plataforma crea o modifica empresas y licencias; las empresas solo consultan las suyas.
- Numeración de facturas sin saltos con `next_invoice_number(serie)` dentro de la transacción de la venta.
- Dinero en `numeric(14,2)`; cantidades en `numeric(14,3)`.

## Funciones de autenticación
`auth_get_user_by_email(email)` y `auth_list_memberships(user_id)` corren como el dueño para resolver el login
antes de conocer la empresa. Devuelven solo las columnas necesarias.

## Pendiente para fases siguientes
- FASE 3: tablas `sessions`, `password_resets`, `user_2fa` y la creación del primer superadministrador.
- FASE 5: canje de claves de licencia (función dedicada, porque la empresa vencida no tiene contexto activo).
- Al crear un usuario dentro de una empresa: generar el UUID en la aplicación y no usar `RETURNING`
  hasta crear su `company_users`.
