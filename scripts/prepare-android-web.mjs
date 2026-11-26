import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function localAssetReferences(html) {
  const refs = [];
  const patterns = [/<script\b[^>]*\bsrc=["']([^"']+)["']/gi, /<link\b[^>]*\bhref=["']([^"']+)["']/gi];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1];
      if (!value || /^(?:[a-z]+:|\/\/|#|data:)/i.test(value)) continue;
      refs.push(value.split(/[?#]/, 1)[0]);
    }
  }
  return [...new Set(refs)];
}

export async function prepareAndroidWeb({
  source = path.join(projectRoot, ".output", "public"),
  destination = path.join(projectRoot, "native", "www"),
} = {}) {
  const indexPath = path.join(source, "index.html");
  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo?.isDirectory()) throw new Error(\`Android web build directory not found: \${source}\`);
  const html = await readFile(indexPath, "utf8").catch(() => {
    throw new Error(\`Android SPA shell missing: \${indexPath}. Expected index.html from the dedicated SPA build.\`);
  });
  if (/schermata locale di riserva|LEONIDA_WEB_URL/i.test(html)) {
    throw new Error("Refusing to package the native/www placeholder instead of the compiled application.");
  }
  if (!/<div\b[^>]*id=["']root["']|<div\b[^>]*id=["']app["']/i.test(html)) {
    throw new Error("Generated index.html does not contain a recognized application mount element.");
  }
  for (const asset of localAssetReferences(html)) {
    const assetPath = path.resolve(source, asset.replace(/^\//, ""));
    if (!assetPath.startsWith(path.resolve(source) + path.sep)) throw new Error(\`Unsafe asset reference: \${asset}\`);
    const assetInfo = await stat(assetPath).catch(() => null);
    if (!assetInfo?.isFile()) throw new Error(\`Generated app references a missing local asset: \${asset}\`);
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
  const copied = await readdir(destination);
  if (!copied.includes("index.html")) throw new Error("Android web bundle copy did not produce native/www/index.html.");
  return { source, destination, topLevelEntries: copied.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await prepareAndroidWeb();
    console.log(\`Prepared local Android web bundle: \${result.destination} (\${result.topLevelEntries} top-level entries).\`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
