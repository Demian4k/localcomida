import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { backendDir } from "../paths.js";

export const installRouter = Router();

function apkCandidates(): string[] {
  const env = process.env.ANDROID_APK_PATH;
  const root = path.resolve(backendDir(), "..", "..");
  const roots = [
    env,
    path.join(root, "releases", "LocalComida-android.apk"),
    path.join(backendDir(), "..", "releases", "LocalComida-android.apk"),
    path.join(process.cwd(), "releases", "LocalComida-android.apk"),
    path.join(process.cwd(), "..", "releases", "LocalComida-android.apk"),
    path.join(root, "dist-apk", "LocalComida-tablet.apk"),
    path.join(root, "dist-apk", "LocalComida-tablet-debug.apk"),
    path.join(process.cwd(), "..", "dist-apk", "LocalComida-tablet.apk"),
    path.join(process.cwd(), "..", "dist-apk", "LocalComida-tablet-debug.apk"),
  ].filter((p): p is string => Boolean(p));
  return roots;
}

function findApk(): string | null {
  for (const p of apkCandidates()) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

installRouter.get("/android.apk", (_req, res) => {
  const apk = findApk();
  if (!apk) {
    res.status(404).json({
      error:
        "APK no disponible en este servidor. Colócalo en releases/LocalComida-android.apk",
    });
    return;
  }

  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="LocalComida-android.apk"',
  );
  fs.createReadStream(apk).pipe(res);
});

installRouter.get("/android/info", (_req, res) => {
  const apk = findApk();
  if (!apk) {
    res.json({ available: false });
    return;
  }
  const st = fs.statSync(apk);
  res.json({
    available: true,
    size_bytes: st.size,
    path_hint: path.basename(apk),
    download_path: "/api/v1/install/android.apk",
  });
});
