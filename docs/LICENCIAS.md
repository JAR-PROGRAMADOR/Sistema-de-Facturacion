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
- `POST /licenses/redeem` y `POST /user-licenses/redeem`: para poder canjear el código que
  resuelve el bloqueo.
- `POST /licenses/activate`: la que usa la pantalla de activación. Acepta un código de
  empresa, uno de usuario o un código de registro (este último activa las dos a la vez).
  La pantalla muestra el campo para escribir el código siempre, incluso si la consulta
  de estado falla, para no dejar al usuario bloqueado sin forma de activar nada.

## Códigos de activación de 6 dígitos
Ya no hay claves largas: todo código de activación es de **6 dígitos** (`100000`-`999999`,
sin letras), generado con `crypto.randomInt` y verificado como único entre las tres
tablas (`licenses`, `user_licenses`, `registration_licenses`), porque con solo un millón
de códigos posibles dos iguales en ámbitos distintos serían ambiguos al canjear. El
código en claro se muestra **una sola vez** al emitirlo; en la base solo queda su hash
SHA-256. Es de un solo uso: al canjearlo pasa a `ACTIVA` y no vuelve a servir.

Seguridad: un código solo activa licencias de la empresa de quien lo canjea (el
`company_id` sale del token, nunca del cliente), y el canje de un código de registro en
el registro público pasa por el límite de intentos del login (10/min). Las claves
largas emitidas antes del cambio se siguen aceptando por API, pero la interfaz solo
pide códigos de 6 dígitos: las pendientes antiguas hay que revocarlas y emitir un
código nuevo en su lugar.

## Primer superadministrador (arranque)
Sin superadministrador no hay nadie que emita claves y el sistema queda bloqueado:
es el problema del "huevo y la gallina" de las licencias. Se resuelve con las
variables `PLATFORM_ADMIN_EMAIL` y `PLATFORM_ADMIN_PASSWORD` (van juntas, la
contraseña mínimo 12 caracteres). Al arrancar, el servidor llama a la función
`ensure_platform_admin` (migración 0014, `SECURITY DEFINER`, porque `app_user`
no puede escribir `users.is_platform_admin`): si el usuario no existe lo crea
como superadministrador, y si existe solo le da el rol, sin cambiar su
contraseña. Si la migración 0014 no está aplicada, el arranque lo deja en el
log y la API sigue funcionando. Una vez creado, ese usuario entra en
`/licencias` y emite los códigos; las empresas los canjean en la pantalla de
activación. La página de licencias siempre permite emitir un código de
registro, aunque todavía no haya ninguna empresa seleccionada.

> **Si un código de registro falla con un error 500 genérico** ("No fue posible
> completar la operación"), lo más probable es que la base no tenga la tabla
> `registration_licenses`: la migración 0013 llegó con el código pero hay que
> aplicarla a mano con `npm run db:migrate --workspace=@facturacion/api`. Sin
> esa tabla no se puede emitir ni canjear ningún código de registro.

## Ciclo de vida de un código
```
PENDIENTE  →  ACTIVA  (al canjearlo)
ACTIVA     →  SUSPENDIDA / REVOCADA  (el superadministrador, en cualquier momento)
ACTIVA     →  "vencida" en la práctica cuando expires_at < ahora (no cambia el status
               guardado a VENCIDA automáticamente; se calcula al consultar — ver pendiente)
```
1. La plataforma emite el código: `POST /platform/licenses` (empresa) o
   `POST /platform/user-licenses` (usuario), indicando la duración en segundos. El código
   en texto plano se muestra **una sola vez** en la respuesta; solo su hash queda guardado.
2. Quien lo recibe lo canjea desde su propia sesión: `POST /licenses/redeem` o
   `POST /user-licenses/redeem`. Ahí recién se fija `starts_at = ahora` y
   `expires_at = ahora + duración`.
3. El superadministrador puede `suspend`, `revoke` o `reactivate` una licencia ya emitida.

## Código de registro
La plataforma también puede emitir un código de registro de un solo uso con
`POST /platform/registration-licenses`. El formulario público acepta ese código junto con
los datos de la empresa y su administrador. El canje ocurre dentro de la transacción de
registro y crea las licencias activas de empresa y usuario con la vigencia y el cupo del
código. Si el código no es válido o ya se usó, no se crea la cuenta. El código se guarda como
hash y su vigencia empieza al registrarse.

Los códigos tradicionales de empresa y usuario siguen disponibles para renovaciones y para
administrar licencias de cuentas ya existentes.

## Por qué el canje necesita una función SQL especial
Las políticas de seguridad por fila (RLS) de `licenses` y `user_licenses` solo dejan
`UPDATE` a la plataforma — a propósito, para que una empresa nunca pueda cambiarle el
estado a su propia licencia libremente. El canje necesita ser la única excepción
controlada a eso, así que vive en dos funciones `SECURITY DEFINER`
(`redeem_license`, `redeem_user_license`, migración `0006`) que verifican el código por su
hash y la empresa/usuario antes de activarla.

## Pendiente para fases posteriores
- Hacer cumplir `max_users` (impedir crear más usuarios activos que el cupo de la licencia).
- Un proceso de mantenimiento que pase `ACTIVA` a `VENCIDA` cuando `expires_at` ya pasó (hoy
  el estado guardado puede decir `ACTIVA` aunque ya haya vencido; el bloqueo funciona igual
  porque siempre se compara contra `expires_at > now()` en el momento de la consulta, pero
  el *dato* `status` no se actualiza solo).
- Notificar por correo antes de que una licencia venza.
