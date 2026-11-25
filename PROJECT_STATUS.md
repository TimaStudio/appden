# The Appden — Estado del proyecto

Actualizado: 2026-11-25

## Estado

Migrado de Supabase a un stack gratuito (detalles en `docs/MIGRACION_FIREBASE.md`):
Firebase Authentication (correo y Google) + Cloud Firestore + Cloudflare R2 (Worker
`appden-storage`). El frontend se despliega en Firebase App Hosting (https://appdenski.tmst.es) al hacer push a `main`.
`npx tsc --noEmit`, `npm run lint` y `npm run build` pasan.

## Migración (2026-11-25)

- Importados del backup del 17-11-2026: 12 usuarios (con sus contraseñas), perfiles,
  grupos, miembros, invitaciones, amistades, publicaciones, deudas, pagos, insignias,
  objetivos, reportes y notificaciones de deudas/amistad.
- Descartados (los archivos de Supabase Storage se perdieron): canciones, letras,
  álbumes, playlists, favoritos, comentarios, avatares, portadas y archivos. La música
  sigue funcionando para subidas nuevas a R2.
- Las notificaciones y la actividad que antes creaban triggers SQL ahora las crea la app.
- Admin de la app: documento `admins/{uid}` en Firestore (se gestiona desde la consola).

## Hecho en esta revisión

- Auth: sin doble login, recuperación de contraseña
  completa, aviso de cuenta pendiente, invitaciones que sobreviven al login, limpieza
  del reproductor al cerrar sesión.
- Grupos: "mis grupos" solo incluye grupos donde eres miembro, selector de grupo en la
  cabecera, invitación por enlace, salir/eliminar, feedback visible.
- Amigos: página unificada (amigos, solicitudes, buscar) e invitar amigos a grupos.
- Música: filas compactas con menú de acciones, álbumes, artistas (miembros),
  reproductor con gestos, color de portada, controles en pantalla de bloqueo,
  arreglo de reproducción en iOS.
- Cuentas: calculadora de reparto (varios pagadores, iguales/partes/exacto/
  consumiciones, propina, redondeo, transferencias mínimas) en
  `src/features/debts/split.ts`; formulario "Me deben / Debo yo".
- Interfaz: rediseño móvil (bottom sheets, tabs, tipografía, inputs de 16 px) y
  escritorio con menú lateral plegable y barra de reproductor.

## 2026-10-29

- Cuentas: el balance se calcula desde la misma lista de deudas (céntimos, por moneda)
  y muestra el neto con cada persona; ficha de deuda desde tu punto de vista.
- Notificaciones rehechas para móvil (por día, deslizar para borrar, abrir recurso).
- Mantener pulsada una canción abre sus detalles; artistas, álbum y "subida por"
  enlazan a sus páginas (ficha de canción, reproductor y menú). Página de artista nueva.
- Animaciones: elevación al pasar el ratón, zoom de portadas, entrada escalonada,
  respuesta táctil y vibración.

## Pendiente (siguiente sesión)

- Rediseño visual pendiente (funcionan con el estilo antiguo): `LyricsPanel`,
  comentarios de canción, detalle de playlist, paneles de estadísticas de deudas,
  formulario de reportes y la página pública `/shared`.
- Selector de álbum existente en el formulario de subida (la API ya está en
  `src/features/music/services/albums.service.ts`).
- Pasada de tildes en textos antiguos ("cancion", "musica"…).
- Borrar el proyecto antiguo de Supabase cuando ya no se necesite el backup.
