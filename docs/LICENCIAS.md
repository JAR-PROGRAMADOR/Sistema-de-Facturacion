# Sistema de licencias — FASE 5

## Dos niveles, los dos obligatorios (decisión aprobada en la FASE 0)
Para que un usuario no-plataforma pueda usar **cualquier** ruta protegida por un permiso,
hacen falta DOS licencias activas y vigentes al mismo tiempo:
1. Una licencia de **empresa** (`licenses`), con un cupo de usuarios (`max_users`, de
   referencia; el cupo no se hace cumplir todavía — ver "Pendiente" más abajo).
2. Una licencia de **ese usuario en particular** (`user_licenses`).

Si falta cualquiera de las dos, toda ruta que pase por `requirePermission(...)` responde
`402 LICENSE_EXPIRED`, **antes** de siquiera mirar qué permiso tiene el rol del usuario.
Es el "licencia vencida = bloqueo total" aprobado en la FASE 0. El superadministrador de
plataforma nunca necesita licencia (no participa de este sistema).

## Las dos únicas puertas que NO exigen licencia activa
- `GET /license-status`: para que el frontend pueda mostrar "tu licencia venció, aquí tienes
  cómo renovarla" en vez de dejar a la empresa completamente a oscuras.
- `POST /licenses/redeem` y `POST /user-licenses/redeem`: para poder canjear la clave que
  resuelve el bloqueo.

## Ciclo de vida de una clave
```
PENDIENTE  →  ACTIVA  (al canjearla)
ACTIVA     →  SUSPENDIDA / REVOCADA  (el superadministrador, en cualquier momento)
ACTIVA     →  "vencida" en la práctica cuando expires_at < ahora (no cambia el status
               guardado a VENCIDA automáticamente; se calcula al consultar — ver pendiente)
```
1. La plataforma emite la clave: `POST /platform/licenses` (empresa) o
   `POST /platform/user-licenses` (usuario), indicando la duración en segundos. La clave en
   texto plano se muestra **una sola vez** en la respuesta; solo su hash queda guardado.
2. Quien la recibe la canjea desde su propia sesión: `POST /licenses/redeem` o
   `POST /user-licenses/redeem`. Ahí recién se fija `starts_at = ahora` y
   `expires_at = ahora + duración`.
3. El superadministrador puede `suspend`, `revoke` o `reactivate` una licencia ya emitida.

## Clave de registro
La plataforma también puede emitir una clave de registro de un solo uso con
`POST /platform/registration-licenses`. El formulario público acepta esa clave junto con
los datos de la empresa y su administrador. El canje ocurre dentro de la transacción de
registro y crea las licencias activas de empresa y usuario con la vigencia y el cupo de la
clave. Si la clave no es válida o ya se usó, no se crea la cuenta. La clave se guarda como
hash y su vigencia empieza al registrarse.

Las claves tradicionales de empresa y usuario siguen disponibles para renovaciones y para
administrar licencias de cuentas ya existentes.

## Por qué el canje necesita una función SQL especial
Las políticas de seguridad por fila (RLS) de `licenses` y `user_licenses` solo dejan
`UPDATE` a la plataforma — a propósito, para que una empresa nunca pueda cambiarle el
estado a su propia licencia libremente. El canje necesita ser la única excepción
controlada a eso, así que vive en dos funciones `SECURITY DEFINER`
(`redeem_license`, `redeem_user_license`, migración `0006`) que verifican la clave por su
hash y la empresa/usuario antes de activarla.

## Pendiente para fases posteriores
- Hacer cumplir `max_users` (impedir crear más usuarios activos que el cupo de la licencia).
- Un proceso de mantenimiento que pase `ACTIVA` a `VENCIDA` cuando `expires_at` ya pasó (hoy
  el estado guardado puede decir `ACTIVA` aunque ya haya vencido; el bloqueo funciona igual
  porque siempre se compara contra `expires_at > now()` en el momento de la consulta, pero
  el *dato* `status` no se actualiza solo).
- Notificar por correo antes de que una licencia venza.
