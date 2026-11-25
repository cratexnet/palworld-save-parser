import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const DIST_DIR = new URL("../dist/", import.meta.url);

for (const file of await listBuildOutputFiles(DIST_DIR)) {
  const source = await readFile(file, "utf8");
  const next = source.replace(
    /\b(from\s+["'])(\.{1,2}\/[^"']+)(["'])/gu,
    (_match, prefix, specifier, suffix) =>
      `${prefix}${specifierWithJavaScriptExtension(specifier)}${suffix}`,
  );

  if (next !== source) {
    await writeFile(file, next);
  }
}

async function listBuildOutputFiles(directoryUrl) {
  const files = [];

  for (const entry of await readdir(directoryUrl)) {
    const childUrl = new URL(entry, directoryUrl);
    const childStat = await stat(childUrl);

    if (childStat.isDirectory()) {
      files.push(
        ...(await listBuildOutputFiles(new URL(`${entry}/`, directoryUrl))),
      );
    } else if (
      extname(childUrl.pathname) === ".js" ||
      childUrl.pathname.endsWith(".d.ts")
    ) {
      files.push(childUrl);
    }
  }

  return files;
}

function specifierWithJavaScriptExtension(specifier) {
  if (/\.(?:[cm]?js|json|node)$/u.test(specifier)) return specifier;
  return `${specifier}.js`;
}
