import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const arg = process.argv[2] || "debug";

const variants = {
  debug: {
    src: path.join(__dirname, "..", "android", "app", "build", "outputs", "apk", "full", "debug", "app-full-debug.apk"),
    name: "LocalComida-tablet-debug.apk",
    alsoReleases: false,
  },
  release: {
    src: path.join(__dirname, "..", "android", "app", "build", "outputs", "apk", "full", "release", "app-full-release.apk"),
    name: "LocalComida-android.apk",
    alsoReleases: true,
  },
  trial: {
    src: path.join(__dirname, "..", "android", "app", "build", "outputs", "apk", "trial", "debug", "app-trial-debug.apk"),
    name: "LocalComida-prueba.apk",
    alsoReleases: true,
  },
};

const cfg = variants[arg] || variants.debug;
const distApk = path.join(root, "dist-apk");
const releases = path.join(root, "releases");
fs.mkdirSync(distApk, { recursive: true });
fs.mkdirSync(releases, { recursive: true });

if (!fs.existsSync(cfg.src)) {
  console.error("No se encontró el APK en", cfg.src);
  process.exit(1);
}

fs.copyFileSync(cfg.src, path.join(distApk, cfg.name));
console.log(`APK ${arg} → dist-apk/${cfg.name}`);
if (cfg.alsoReleases) {
  fs.copyFileSync(cfg.src, path.join(releases, cfg.name));
  console.log(`También → releases/${cfg.name}`);
}
