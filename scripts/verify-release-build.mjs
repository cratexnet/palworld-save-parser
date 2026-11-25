#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const SOURCE_REPOSITORY = "https://github.com/cratexnet/palworld-save-parser";

async function hashFile(filePath) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

const DIST_DIRECTORY = join(PROJECT_ROOT, "dist-app");
const sourceManifest = JSON.parse(
  await readFile(join(DIST_DIRECTORY, "cratex-source.json"), "utf8"),
);
const buildManifest = JSON.parse(
  await readFile(join(DIST_DIRECTORY, "cratex-build-manifest.json"), "utf8"),
);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: PROJECT_ROOT,
  encoding: "utf8",
})
  .trim()
  .toLowerCase();

if (sourceManifest.sourceRepository !== SOURCE_REPOSITORY) {
  throw new Error("Release source repository is invalid.");
}
if (buildManifest.sourceRepository !== SOURCE_REPOSITORY) {
  throw new Error("Build manifest source repository is invalid.");
}
if (buildManifest.sourceDirty !== false) {
  throw new Error("Build manifest source must be clean.");
}
if (buildManifest.sourceCommit !== sourceCommit) {
  throw new Error("Build manifest source commit does not match git HEAD.");
}
if (sourceManifest.sourceDirty !== false) {
  throw new Error("Release build source must be clean.");
}
if (sourceManifest.sourceCommit !== sourceCommit) {
  throw new Error("Release build source commit does not match git HEAD.");
}
if (
  typeof sourceManifest.sourceArchive !== "string" ||
  !sourceManifest.sourceArchive.startsWith("./source/")
) {
  throw new Error("Release build source archive path is invalid.");
}
if (!/^[0-9a-f]{64}$/.test(sourceManifest.sourceArchiveSha256)) {
  throw new Error("Release source archive SHA-256 is invalid.");
}

const requiredPaths = [
  "COPYRIGHT",
  "LICENSE",
  "THIRD_PARTY_LICENSES.txt",
  "THIRD_PARTY_NOTICES.md",
  "cratex-build-manifest.json",
  "cratex-source.json",
  "licenses/fflate.MIT.txt",
  "licenses/palworld-ooz.GPL-3.0-or-later.txt",
  "licenses/palworld-v1.MIT.txt",
  sourceManifest.sourceArchive.slice(2),
];
await Promise.all(
  requiredPaths.map((relativePath) =>
    access(join(DIST_DIRECTORY, relativePath)),
  ),
);
const sourceArchivePath = join(
  DIST_DIRECTORY,
  sourceManifest.sourceArchive.slice(2),
);
const sourceArchiveSha256 = await hashFile(sourceArchivePath);
if (sourceArchiveSha256 !== sourceManifest.sourceArchiveSha256) {
  throw new Error("Release source archive SHA-256 does not match the archive.");
}

const indexHtml = await readFile(join(DIST_DIRECTORY, "index.html"), "utf8");
for (const marker of ['rel="license"', "/LICENSE", "/cratex-source.json"]) {
  if (!indexHtml.includes(marker)) {
    throw new Error(
      `Release HTML is missing source/license discovery: ${marker}`,
    );
  }
}

const thirdPartyLicenses = await readFile(
  join(DIST_DIRECTORY, "THIRD_PARTY_LICENSES.txt"),
  "utf8",
);
for (const marker of [
  "fflate",
  "Palworld Ooz decoder",
  "corresponding source",
]) {
  if (!thirdPartyLicenses.includes(marker)) {
    throw new Error(`Release license index is missing: ${marker}`);
  }
}
