# Decisiones arquitectónicas (FASE 0)

| # | Decisión |
|---|---|
| D1 | Monolito modular. Stack: TypeScript, React + Vite, Fastify, PostgreSQL, Drizzle ORM |
| D2 | Multiempresa: una base de datos, `company_id` en toda tabla de negocio, RLS de PostgreSQL |
| D3 | Hosting inicial gratuito (Postgres gestionado, API en contenedor, frontend estático), con ruta a plan de pago |
| D4 | Operación global: sin reglas fiscales de un país en el núcleo; perfil fiscal por empresa y adaptadores futuros |
| D5 | Licencia vencida: bloqueo total (solo login, logout y pantalla de renovación) |
| D6 | Licencias por empresa (período y cupo de usuarios) y por usuario; ambas deben estar vigentes |
| D7 | Una moneda por empresa; varias tasas de impuesto |
| D8 | Bienes y servicios; caja con apertura y cierre de turno |
| D9 | Correo transaccional con nivel gratuito (recuperación de contraseña) |
| D10 | Sin migración de datos; seed mínimo (permisos, roles plantilla, superadmin) |
| D11 | Idiomas: es, en, tr, zh-CN, ja, ko |
