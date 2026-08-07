# ADR: Shell nativo dual + nodo principal en LAN

## Estado

Aceptado — 2026-07-28 (actualizado: tablet como principal)

## Contexto

LocalComida necesita varias tablets de caja con **inventario sincronizado** en Wi‑Fi local,
y que una tablet pueda ser el equipo principal si no hay PC.

## Decisión

1. **Un solo nodo escritor** (fuente de verdad): Express + SQLite en el equipo principal.
2. El principal puede ser:
   - **PC Windows o Mac** (Electron + better-sqlite3), o
   - **Tablet Android** (Capacitor + Node.js embebido + JSON/sql ligero).
   - Build Mac: `docs/MAC-BUILD.md` (`npm run dist:mac` en un Mac).
3. El resto de dispositivos son **clientes LAN** (`lc_api_base` → `http://IP:8000`).
4. **No** hay multi-master ni sincronización peer-to-peer de SQLite (evita conflictos de stock).
5. Varias cajas = varios clientes HTTP al mismo API → el inventario ya queda coherente
   porque las ventas descuentan stock en transacciones en el servidor.

## Flujo móvil

1. ¿Principal o me conecto a otra?
2. Caja o Preparación
3. Si cliente → conectar Wi‑Fi/QR/código
4. Si principal → arrancar Node embebido en `127.0.0.1:8000` y escuchar `0.0.0.0:8000` para peers
5. Login → app

## Consecuencias

- La tablet principal debe permanecer encendida (y preferible enchufada) mientras haya cajas.
- Actualizar el APK actualiza UI; la base de datos del principal permanece en el almacenamiento de la app.
- Impresión USB Windows no aplica en tablet-host; red `:9100` sí si el runtime lo permite.

## Alternativas descartadas

- Multi-master / sync de fichero SQLite entre tablets (corrupción y stock incorrecto).
- Que cada tablet tenga su inventario local.
- Reescritura completa en Kotlin Room (coste alto; el contrato HTTP actual se reutiliza).
