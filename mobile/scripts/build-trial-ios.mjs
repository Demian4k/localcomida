/**
 * Genera build iOS de prueba (20 días) con VITE_TRIAL=1.
 * Capacitor 8 + Capawesome Nodejs usan Swift Package Manager (no CocoaPods).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(mobileRoot, "..");
const iosApp = path.join(mobileRoot, "ios", "App");
const outDir = path.join(repoRoot, "dist-ios");

if (process.platform !== "darwin") {
  console.error("build-trial-ios solo funciona en macOS.");
  process.exit(1);
}

function run(cmd, args, cwd, env = process.env) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const trialEnv = { ...process.env, VITE_TRIAL: "1" };

fs.mkdirSync(outDir, { recursive: true });

run("npm", ["run", "build"], path.join(repoRoot, "frontend"), trialEnv);
run("npm", ["run", "bundle:host"], path.join(repoRoot, "backend"));
run("node", ["scripts/copy-nodejs-into-dist.mjs"], mobileRoot);

const iosDir = path.join(mobileRoot, "ios");
if (!fs.existsSync(path.join(mobileRoot, "node_modules", "@capacitor", "ios"))) {
  run("npm", ["install", "@capacitor/ios"], mobileRoot);
}
if (!fs.existsSync(iosDir)) {
  run("npx", ["cap", "add", "ios"], mobileRoot);
}

run("npx", ["cap", "sync", "ios"], mobileRoot);

const project = path.join(iosApp, "App.xcodeproj");
const derived = path.join(outDir, "DerivedData");
const archivePath = path.join(outDir, "LocalComida-prueba.xcarchive");

run("xcodebuild", ["-project", project, "-scheme", "App", "-resolvePackageDependencies"], iosApp);

run(
  "xcodebuild",
  [
    "-project",
    project,
    "-scheme",
    "App",
    "-configuration",
    "Release",
    "-sdk",
    "iphonesimulator",
    "-derivedDataPath",
    derived,
    "-destination",
    "generic/platform=iOS Simulator",
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ],
  iosApp,
);

const appCandidates = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name.endsWith(".app")) appCandidates.push(full);
      else walk(full);
    }
  }
}
walk(path.join(derived, "Build", "Products"));

const simApp = appCandidates.find((p) => p.includes("iphonesimulator")) ?? appCandidates[0];
if (simApp) {
  const zipOut = path.join(outDir, "LocalComida-prueba-simulator.app.zip");
  fs.rmSync(zipOut, { force: true });
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", simApp, zipOut], outDir);
  console.log(`Simulador: ${zipOut}`);
}

const hasSigning =
  Boolean(process.env.IOS_CERTIFICATE_BASE64) && Boolean(process.env.IOS_PROVISION_PROFILE_BASE64);

if (hasSigning) {
  console.log("\nCertificados iOS detectados: generando .ipa firmado…");
  run(
    "xcodebuild",
    [
      "-project",
      project,
      "-scheme",
      "App",
      "-configuration",
      "Release",
      "-destination",
      "generic/platform=iOS",
      "-archivePath",
      archivePath,
      "archive",
    ],
    iosApp,
  );

  const exportPlist = path.join(outDir, "ExportOptions.plist");
  fs.writeFileSync(
    exportPlist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${process.env.IOS_EXPORT_METHOD || "ad-hoc"}</string>
  <key>compileBitcode</key>
  <false/>
  <key>signingStyle</key>
  <string>manual</string>
</dict>
</plist>
`,
  );

  const exportDir = path.join(outDir, "ipa");
  fs.rmSync(exportDir, { recursive: true, force: true });
  run(
    "xcodebuild",
    [
      "-exportArchive",
      "-archivePath",
      archivePath,
      "-exportPath",
      exportDir,
      "-exportOptionsPlist",
      exportPlist,
    ],
    iosApp,
  );

  const ipas = fs.existsSync(exportDir)
    ? fs.readdirSync(exportDir).filter((f) => f.endsWith(".ipa"))
    : [];
  for (const ipa of ipas) {
    fs.copyFileSync(path.join(exportDir, ipa), path.join(outDir, "LocalComida-prueba.ipa"));
  }
  console.log("IPA: dist-ios/LocalComida-prueba.ipa");
} else {
  console.log(`
Sin certificados Apple en el entorno: se genera la app de simulador.
Para .ipa instalable en iPhone/iPad reales, configura en GitHub Secrets:
  IOS_CERTIFICATE_BASE64, IOS_CERTIFICATE_PASSWORD,
  IOS_PROVISION_PROFILE_BASE64, KEYCHAIN_PASSWORD
`);
  fs.writeFileSync(
    path.join(outDir, "LEEME-iOS.txt"),
    `LocalComida Prueba (iOS)
=======================

Este artifact incluye LocalComida-prueba-simulator.app.zip
(para Xcode Simulator en un Mac).

Para instalar en iPhone/iPad físicos hace falta cuenta Apple Developer
y certificados en los secrets del repositorio (ver docs/GITHUB-APPLE-CI.md).

La app de prueba se bloquea a los 20 días desde el primer uso.
`,
  );
}

console.log("\nListo iOS prueba → dist-ios/");
