# Migración Supabase → Firebase (plan gratuito) + Cloudflare R2

Estado: aplicado el 2026-11-25. Supabase se ha retirado del código.

## Objetivo

Que la app funcione sin coste: autenticación, base de datos y hosting en Firebase
(plan Spark, sin tarjeta) y archivos nuevos en Cloudflare R2. La web sigue desplegándose en Vercel desde `main`. Una vez verificada,
se elimina todo lo relacionado con Supabase.

No objetivos: migrar los archivos antiguos de Supabase Storage (se dan por
perdidos), ni las canciones, letras, álbumes, listas, favoritos, portadas e imágenes
que dependían de ellos. Antiobjetivo: cualquier servicio que exija el plan Blaze
(Cloud Functions, Cloud Run, Cloud SQL).

## Arquitectura

| Pieza | Tecnología |
|---|---|
| Login, registro, recuperación | Firebase Authentication (correo + contraseña y Google) |
| Datos | Cloud Firestore (`eur3`), colecciones planas con los mismos nombres de campo que las tablas SQL |
| Permisos | Reglas de seguridad de Firestore (sustituyen a RLS) |
| Lógica de servidor (RPC) | Lotes (`writeBatch`) y reglas; el Worker solo firma URLs de R2 |
| Archivos | Cloudflare R2 + Worker `appden-storage` validando el token de Firebase |
| Web | Vercel (despliegue automático desde `main`) |

## Decisiones de modelo

- **Los ids se conservan.** Los usuarios se importan con `auth:import` usando su UUID
  antiguo como `uid`, así que todas las claves foráneas siguen valiendo y las
  contraseñas (bcrypt) siguen funcionando.
- **Colecciones planas** (`profiles`, `groups`, `debts`, `posts`...) con los campos
  tal cual estaban en SQL: los tipos de `src/types` y las páginas no cambian.
- **Pertenencia a grupos:** `groups/{id}.member_ids` (array) permite consultar "mis
  grupos" con `array-contains` y evaluar permisos en reglas con un solo `get()`.
  `group_members` se mantiene como colección con id `{group_id}_{user_id}` para guardar rol y fecha.
- **Sin joins:** los servicios cargan perfiles por lotes (`in` de hasta 30 ids) y los
  incrustan en el cliente. Los datos son pequeños (12 usuarios), por lo que se ordena
  y filtra en cliente salvo en listas que pueden crecer (notificaciones, actividad),
  que usan índices compuestos.
- **RPC → cliente + reglas:**
  - `create_group_with_owner`: `writeBatch` (grupo + miembro owner).
  - `join_group_with_invite`: el token vive en `group_invite_tokens/{token}`; las reglas
    permiten añadirse como miembro solo si el token existe y no ha caducado.
  - `leave_group`, `respond_group_invitation`: lotes cuyas escrituras validan las reglas.
  - `approve/reject_account_request` y `is_app_admin`: colección `admins/{uid}`
    (solo lectura para el propio usuario; se rellena desde la consola o un script).
- **Aprobación de cuentas:** al registrarse se crea `profiles/{uid}` con `is_approved: false`.
  Solo un admin puede cambiarlo.
- **Notificaciones y actividad:** antes las creaban triggers; ahora las crea el cliente
  que ejecuta la acción. Las reglas exigen `actor_id == auth.uid`.
- **Archivos:** las rutas siguen siendo `<bucket>/<ruta>` en R2. El Worker valida el ID
  token de Firebase (JWKS de `securetoken@system.gserviceaccount.com`) y comprueba la
  pertenencia a grupo leyendo `groups/{id}` por la API REST de Firestore con el token del
  propio usuario (las reglas deciden).

## Límites del plan gratuito y mitigación

Firestore Spark: 50.000 lecturas y 20.000 escrituras al día; al agotarlas, el servicio
se corta hasta el día siguiente. Mitigación: React Query con `staleTime` alto, listas con
`limit`, y evitar listeners en tiempo real.

## Datos importados (copia del 17-11-2026)

Se importan: usuarios y perfiles, grupos, miembros, invitaciones, amistades y solicitudes,
deudas y pagos, publicaciones y me gusta, notificaciones, actividad, informes, changelog,
insignias y objetivos. Se descartan: canciones, letras, comentarios, reacciones, álbumes,
listas, favoritos, archivos y enlaces compartidos de objetos.

## Fases

1. Cliente Firebase, helpers y autenticación.
2. Servicios sociales y de deudas sobre Firestore.
3. Servicios de música/archivos (nuevas subidas a R2).
4. Reglas e índices.
5. Worker de R2 con tokens de Firebase.
6. Importación de datos y usuarios.
7. Verificación y retirada de Supabase.

## Resultado

- Importados 12 usuarios (con su contraseña bcrypt) y 117 documentos; admin: `admins/{uid}`.
- El Worker usa el bucket `appden-media`. Para cambiar de bucket basta con editar
  `bucket_name` en `r2-worker/wrangler.toml` (añadiendo `jurisdiction = "eu"` si es europeo) y
  ejecutar `npm run storage:deploy`.
