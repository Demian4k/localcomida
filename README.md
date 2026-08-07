# LocalComida POS

Sistema de gestión de local gastronómico (nodo único): POS, inventario por recetas, ruteo de impresoras por zona.

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind
- **Backend:** Node.js + Express + better-sqlite3
- **Auth:** JWT + PIN hasheado (bcrypt) + RBAC

## Arranque rápido

```bash
# Terminal 1 — API
cd backend
npm install
npm run seed
npm run dev

# Terminal 2 — UI
cd frontend
npm install
npm run dev
```

Abre http://localhost:5173

### Credenciales demo

| Usuario    | PIN  | Rol            |
|-----------|------|----------------|
| admin     | 0000 | Administrador  |
| cajero_01 | 1234 | Cajero         |

## Impresoras (real)

- **Escanear** en Hardware detecta:
  - Impresoras instaladas en Windows (USB / spooler), excluyendo PDF/Fax virtuales
  - Equipos en la LAN con puerto **9100** abierto (ESC/POS)
- **Probar impresión** envía un ticket ESC/POS real (TCP o spooler Windows RAW)
- Las ventas enrutan e imprimen de verdad (no simulación)
- Para desarrollo sin hardware: `PRINT_DRY_RUN=true` en `backend/.env`

## API

Base: `http://localhost:8000/api/v1`

- `POST /auth/login`
- `GET /catalog/products`
- `GET /inventory/ingredients`
- `PUT /inventory/ingredients/:id/stock` (Admin)
- `POST /orders` (transacción ACID + cola de impresión async)
- `GET /hardware/scan` (Admin)
- `PUT /hardware/printers/:id/assign` (Admin)

## Notas de diseño

- Dinero e inventario sin float: enteros (CLP) y centi-unidades de stock.
- Ventas en transacción SQLite con rollback si falla el stock.
- Impresión en cola no bloqueante; alertas no bloqueantes en UI.
- RBAC en backend (403 si un cajero intenta borrar/ajustar inventario).

## Builds Apple (versión de prueba)

Cada push a `main` dispara GitHub Actions en un Mac virtual y publica:

- **Mac:** `.dmg` LocalComida Prueba (20 días)
- **iOS:** app de simulador; `.ipa` si configurás certificados

Ver [docs/GITHUB-APPLE-CI.md](docs/GITHUB-APPLE-CI.md).
