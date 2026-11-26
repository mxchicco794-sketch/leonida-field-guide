import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const workflow = await readFile(path.join(root, ".github/workflows/android-apk.yml"), "utf8");
const nativePkg = JSON.parse(await readFile(path.join(root, "native/package.json"), "utf8"));
const requiredScripts = ["build:android", "prepare:android-web", "bundle:android-web"];
const failures = [];
for (const name of requiredScripts) if (!pkg.scripts?.[name]) failures.push(`Missing root script: ${name}`);
for (const fragment of [
  "bun install --frozen-lockfile",
  "bun run build:android",
  "bun run prepare:android-web",
  "npx cap add android",
  "npx cap sync android",
  "./gradlew assembleDebug",
  "actions/upload-artifact@v4",
  "native/android/app/build/outputs/apk/debug/app-debug.apk",
]) if (!workflow.includes(fragment)) failures.push(`Workflow step missing: ${fragment}`);
if (!nativePkg.dependencies?.["@capacitor/android"] || !nativePkg.devDependencies?.["@capacitor/cli"]) {
  failures.push("Capacitor Android runtime/CLI dependencies are not declared.");
}
if (failures.length) {
  console.error(failures.map((x) => `FAIL ${x}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS Android workflow references all required scripts, Capacitor packages and APK artifact path.");
}
