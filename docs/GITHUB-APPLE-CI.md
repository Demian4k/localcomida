# GitHub Actions — Mac e iOS (versión de prueba)

En cada **push a `main`**, el workflow [`.github/workflows/apple-trial.yml`](../.github/workflows/apple-trial.yml) abre un Mac virtual de GitHub, instala Node/Xcode tools y genera:

| Artefacto | Contenido |
|-----------|-----------|
| **LocalComida-prueba-mac** | `.dmg` / `.zip` Electron de prueba (20 días) |
| **LocalComida-prueba-ios** | App de simulador (siempre) y `.ipa` si hay certificados |

## Cómo descargar

1. Repo → pestaña **Actions**
2. Entrá al run más reciente (verde)
3. Al final: **Artifacts** → descargá Mac y/o iOS

También podés lanzarlo a mano: **Actions → Apple trial builds → Run workflow**.

## Mac (.dmg)

Sin cuenta Apple Developer alcanza. En el Mac del local:

1. Abrí el `.dmg` → arrastrá a Aplicaciones
2. Primera vez: clic derecho → **Abrir** (Gatekeeper)

Es la versión de **prueba** (se bloquea a los 20 días).

## iPhone / iPad

### Sin certificados (por defecto)

CI genera `LocalComida-prueba-simulator.app.zip` para probar en el **Simulador** de Xcode en un Mac.

El proyecto iOS usa **Swift Package Manager** (Capacitor 8 + plugin Node.js de Capawesome; no CocoaPods).

### Con certificados (IPA para dispositivo real)

En el repo: **Settings → Secrets and variables → Actions**, agregá:

| Secret | Descripción |
|--------|-------------|
| `IOS_CERTIFICATE_BASE64` | Certificado `.p12` en base64 |
| `IOS_CERTIFICATE_PASSWORD` | Contraseña del `.p12` |
| `IOS_PROVISION_PROFILE_BASE64` | Perfil `.mobileprovision` en base64 |
| `KEYCHAIN_PASSWORD` | Password temporal del keychain en CI |
| `IOS_EXPORT_METHOD` | Opcional: `ad-hoc`, `development` o `app-store` |

Ejemplo en Mac para generar base64:

```bash
base64 -i TuCertificado.p12 | pbcopy
base64 -i TuPerfil.mobileprovision | pbcopy
```

Hace falta cuenta **Apple Developer** (~99 USD/año) para perfiles que instalen en dispositivos físicos.

**Nota:** Capacitor 8 requiere **Xcode 26+**. El workflow usa runners `macos-26` de GitHub Actions.

## Comandos locales (en un Mac)

```bash
npm install
npm install --prefix frontend
npm install --prefix backend
npm install --prefix mobile

npm run dist:mac:trial   # .dmg prueba
npm run ios:trial        # iOS prueba → dist-ios/
```

## Nota

La versión **completa** (sin límite de días) se sigue generando en Windows/Android con `npm run dist:win` / `npm run apk`. Este workflow de GitHub está pensado para la **prueba** Apple.
