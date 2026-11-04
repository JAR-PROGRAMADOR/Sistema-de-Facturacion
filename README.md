<<<<<<< HEAD
# Plataforma de facturación y gestión empresarial

Monorepo Full Stack (TypeScript): `apps/api` (Fastify) y `apps/web` (React + Vite). Base de datos: PostgreSQL.

## Requisitos
- Node.js 20 o superior
- Docker (para PostgreSQL local, desde la FASE 2)

## Primeros pasos
```bash
cp .env.example .env        # completa los valores
npm install
npm run dev:api             # http://localhost:3000/api/v1/health
npm run dev:web             # http://localhost:5173
npm run typecheck && npm test && npm run build
```
Base local (se usa desde la FASE 2): `docker compose up -d db`

## Estructura
- `apps/api/src/modules/<modulo>`: routes, controller, service, repository y schema por módulo
- `apps/api/src/plugins`: autenticación, tenant, licencia, permisos (fases 3 a 5)
- `apps/api/src/database`: conexión, migraciones, RLS (Fase 2)
- `apps/web/src/i18n`: idiomas es, en, tr, zh-CN, ja, ko
- `docs/DECISIONS.md`: decisiones arquitectónicas aprobadas

## Convenciones de la API
- Prefijo `/api/v1`
- Éxito: `{ "data": ... }`. Error: `{ "error": { "code", "message", "details?" } }`
=======
# Sistema-de-Facturacion
>>>>>>> a1acb815b9ed6c2f551553a4e5ffc9165845d892
