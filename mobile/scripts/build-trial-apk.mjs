/**
 * Genera APK de prueba (20 días) con VITE_TRIAL=1 y flavor Android `trial`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(mobileRoot, "..");

function run(cmd, args, cwd, env = process.env) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const trialEnv = { ...process.env, VITE_TRIAL: "1" };

run("npm", ["run", "build"], path.join(repoRoot, "frontend"), trialEnv);
run("npm", ["run", "bundle:host"], path.join(repoRoot, "backend"));
run("node", ["scripts/copy-nodejs-into-dist.mjs"], mobileRoot);
run("npx", ["cap", "sync", "android"], mobileRoot);
run(".\\gradlew.bat", ["assembleTrialDebug"], path.join(mobileRoot, "android"));
run("node", ["scripts/copy-apk.mjs", "trial"], mobileRoot);

console.log("\nListo: dist-apk/LocalComida-prueba.apk (se bloquea a los 20 días)");
