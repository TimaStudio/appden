# 🚀 QUICK START - The Appden

### 1. Instala dependencias
```bash
npm install
```

### 2. Lanza la app
```bash
npm run dev
```

✅ Abre http://127.0.0.1:4173 y entra con tu cuenta (correo y contraseña o Google).

No hace falta `.env.local`: por defecto la app usa el proyecto de Firebase `appdenski` y el Worker de R2
de producción. Para apuntar a otro proyecto, define `VITE_FIREBASE_*` y `VITE_STORAGE_URL` en `.env.local`.

---

## 🐛 Si se queda cargando

- En el login, pulsa **"¿Problemas para entrar? Reparar la sesión de este dispositivo"**.
- Abre DevTools (F12) → Console y busca errores de Firebase.
- `Missing or insufficient permissions` → una regla de `firestore.rules` ha rechazado la petición.
- `auth/unauthorized-domain` → añade el dominio en Firebase → Authentication → Settings → Authorized domains.

---

## ✅ ¿Funciona?

- [ ] Ves "Entrar" o "Crear cuenta"
- [ ] Puedes entrar con email/contraseña o Google
- [ ] Ves el dashboard y tus grupos

Las cuentas nuevas quedan pendientes hasta que un admin las apruebe.

Más detalles en [README.md](README.md).
