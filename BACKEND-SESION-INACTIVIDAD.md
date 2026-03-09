# Backend: cierre de sesión por inactividad (móviles)

Para que la sesión se cierre por inactividad también en navegadores móviles, el **frontend** ya hace lo siguiente:

- Envía el token en cabecera `Authorization: Bearer <token>` en todas las peticiones (excepto login/registro).
- Al volver a la app (visibility/focus/pageshow) y cada ~90 s en primer plano, llama a `GET /usuario/session-check`.
- Si el backend responde **401**, el frontend cierra sesión y redirige al login.

Para que esto funcione, el **backend** debe implementar lo siguiente.

## 1. Endpoint `GET /usuario/session-check`

- **Autenticación**: Requiere token (p. ej. cabecera `Authorization: Bearer <token>`).
- **Comportamiento**:
  - Si el token es válido y la sesión **no** ha superado el tiempo de inactividad configurado:
    - Actualizar `last_activity_at` del usuario/sesión a “ahora”.
    - Responder **200** (puede devolver algo como `{ "ok": true }` o vacío).
  - Si el token es inválido o la sesión ha superado el tiempo de inactividad (p. ej. `now - last_activity_at > minutosInactividad`):
    - Responder **401** (y opcionalmente invalidar el token/sesión).

El tiempo de inactividad (minutos) puede venir de tu tabla de configuración (igual que en el frontend, p. ej. `minutosInactividad`).

## 2. Actualizar `last_activity_at` en peticiones autenticadas

En todas las rutas que requieran autenticación (o en un middleware común):

- Tras validar el token, actualizar `last_activity_at` del usuario/sesión a la fecha/hora actual.
- Si `now - last_activity_at > minutosInactividad`, responder **401** y no ejecutar la lógica de la ruta (y opcionalmente invalidar la sesión).

Así, si el usuario deja la app abierta en el móvil y no hay peticiones (ni heartbeat) durante X minutos, la siguiente petición (incluida `session-check`) recibirá 401 y el frontend cerrará sesión.

## 3. Resumen

| Acción backend | Descripción |
|----------------|-------------|
| `GET /usuario/session-check` | Requiere token; si sesión válida y no expirada → actualizar `last_activity_at` y 200; si no → 401. |
| Rutas autenticadas | Actualizar `last_activity_at` en cada petición; si inactividad > config → 401. |
| Almacenar por token/sesión | `last_activity_at` (y opcionalmente `minutosInactividad` desde configuración). |

Con esto, el cierre de sesión por inactividad queda controlado por el servidor y funciona también en móviles cuando el usuario vuelve a la app o hace cualquier petición después de estar inactivo.
