# Generar keystore de release (una vez por proyecto)

En PowerShell, desde `mobile/android`:

```powershell
keytool -genkeypair -v -keystore localcomida-release.jks -alias localcomida -keyalg RSA -keysize 2048 -validity 10000
```

Crear `mobile/android/keystore.properties` (gitignored):

```
storeFile=../localcomida-release.jks
storePassword=***
keyAlias=localcomida
keyPassword=***
```

O regenerar la ruta con:

```
cd mobile
node scripts/ensure-keystore-props.mjs
```

(`LC_KEYSTORE_PASS` opcional; por defecto usa la contraseña del JKS de desarrollo local.)

Luego:

```
cd mobile
npm run apk:release
```

El APK firmado queda en `releases/LocalComida-android.apk` y `dist-apk/`.
El host lo sirve en `GET /api/v1/install/android.apk`.
