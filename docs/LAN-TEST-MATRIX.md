# Matriz de pruebas LAN — LocalComida nativo

Marca cada fila al entregar a un cliente.

| # | Escenario | Esperado | OK |
|---|-----------|----------|----|
| 1 | Solo PC (Electron portable) | Abre ventana propia; **no** abre Chrome/Edge | |
| 1b | Tablet como principal | «Esta es la principal» → arranca API; otras tablets se conectan a su IP | |
| 2 | Login + venta en caja | Orden con número diario; stock baja | |
| 2b | Dos tablets caja + un principal | Venta en A baja stock visto en B al refrescar/nueva venta | |
| 3 | PC + 1 tablet Preparación | Tablet: Modo→Conectar→Login→zona; ve tickets; Lista → toast en caja | |
| 4 | PC + tablet Caja + tablet Preparación | Segunda caja opera; cocina sincronizada | |
| 5 | Cambio de IP del router | Reconectar (buscar Wi‑Fi / código); datos intactos en PC | |
| 6 | Host reiniciado | Tablets reconectan al mismo servidor | |
| 7 | PIN incorrecto ×5 | 429 / mensaje de espera; audit LOGIN_FAILED | |
| 8 | APK viejo vs host nuevo | Bloqueo por `min_client_version` + enlace descarga APK | |
| 9 | WAN/datos móviles off, Wi‑Fi local on | Login, venta, cocina siguen | |
| 10 | Impresión papel opcional | Con print_enabled off: solo pantalla; on: ticket + pantalla | |
| 11 | Emparejamiento código | Código 6 dígitos desde Conectar tablets; claim OK | |
| 12 | CORS / origen raro | Navegador externo agresivo no debería operar como app de confianza | |

## Checklist seguridad rápida

- [ ] Build cliente sin JWT_SECRET de desarrollo hardcodeado
- [ ] Rate limit login activo
- [ ] `android:allowBackup="false"`
- [ ] APK release firmado en `releases/LocalComida-android.apk` (o debug documentado como temporal)

## Rollback

Conservar APK anterior en `releases/` del host antes de reemplazar.
