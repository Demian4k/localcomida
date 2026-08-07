#!/usr/bin/env node
/**
 * Escribe keystore.properties apuntando al JKS local (si existe).
 * No imprime secretos. Ejecutar desde mobile/android si hace falta regenerar la config.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const androidDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "android");
const jks = path.join(androidDir, "localcomida-release.jks");
const propsPath = path.join(androidDir, "keystore.properties");

if (!fs.existsSync(jks)) {
  console.error("Falta localcomida-release.jks. Sigue docs/ANDROID-SIGNING.md");
  process.exit(1);
}

const storePass = process.env.LC_KEYSTORE_PASS || "localcomida-store";
const content = [
  "storeFile=../localcomida-release.jks",
  `storePassword=${storePass}`,
  "keyAlias=localcomida",
  `keyPassword=${storePass}`,
  "",
].join("\n");

fs.writeFileSync(propsPath, content, "utf8");
console.log("Escrito keystore.properties (ruta JKS corregida).");
