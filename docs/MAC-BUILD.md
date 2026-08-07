# LocalComida para Mac

## Qué obtienes

- App **LocalComida.app** empaquetada en un **`.dmg`** (y `.zip` de respaldo).
- Mismo rol que el portable de Windows: puede ser **nodo principal** (API + SQLite) o usarse en la misma red que un PC/Android principal.
- Tablets Android / otras cajas se sincronizan igual (Wi‑Fi + QR / código).

## Requisitos

| Requisito | Notas |
|-----------|--------|
| Un **Mac** | El `.dmg` **no** se puede generar desde Windows |
| Node.js LTS | [nodejs.org](https://nodejs.org) |
| Xcode Command Line Tools | `xcode-select --install` (para nativos como better-sqlite3) |

Cuenta Apple Developer **no** es obligatoria para uso interno: la primera vez macOS pedirá *Clic derecho → Abrir*. Para distribuir sin avisos (notarización) sí hace falta la cuenta (~99 USD/año).

## Cómo generar el instalador

En el Mac, dentro de la carpeta del proyecto:

```bash
npm install
npm run dist:mac
```

Salida típica (Apple Silicon):

```
dist-instalador/LocalComida-1.1.2-mac-arm64.dmg
dist-instalador/LocalComida-1.1.2-mac-arm64.zip
```

En Mac Intel:

```
…-mac-x64.dmg
```

## Instalar en el Mac del local

1. Abre el `.dmg`.
2. Arrastra **LocalComida** a **Aplicaciones**.
3. Primera apertura: clic derecho en la app → **Abrir** → Abrir.
4. Elige modo Caja (principal) o conéctate a otro equipo como en Windows/Android.

## Notas técnicas

- `prepare-client:mac` descarga Node portable Darwin y recompila `better-sqlite3` para esa arquitectura.
- Electron arranca el servidor local en el puerto **8000** y abre la UI en ventana nativa (sin Safari).
- Arm64 y x64 son **builds separados**; no hay binario universal en v1.

## Próximo paso

- **iPhone / iPad:** build automático en GitHub Actions (versión de prueba). Ver `docs/GITHUB-APPLE-CI.md`.
- Notarización Apple (cuenta Developer) para evitar el aviso de Gatekeeper en Mac.
