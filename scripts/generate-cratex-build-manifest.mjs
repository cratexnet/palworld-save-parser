import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_REPOSITORY = "https://github.com/cratexnet/palworld-save-parser";
const MANIFEST_FILENAME = "cratex-build-manifest.json";
const EXCLUDED_PATHS = new Set([MANIFEST_FILENAME]);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function assertDistDirectory(distDirectory) {
  let distStat;

  try {
    distStat = await stat(distDirectory);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(`dist-app directory does not exist: ${distDirectory}`);
    }
    throw error;
  }

  if (!distStat.isDirectory()) {
    throw new Error(`dist-app path is not a directory: ${distDirectory}`);
  }
}

async function collectRegularFiles(
  distDirectory,
  directory = distDirectory,
  relativeDirectory = "",
  files = [],
) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      await collectRegularFiles(
        distDirectory,
        absolutePath,
        relativePath,
        files,
      );
    } else if (entry.isFile() && !EXCLUDED_PATHS.has(relativePath)) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export function readSourceCommit(projectRoot = DEFAULT_PROJECT_ROOT) {
  let sourceCommit;
  try {
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .toLowerCase();
  } catch {
    return null;
  }

  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sourceCommit)) {
    throw new Error(
      `git HEAD is not a 40- or 64-digit commit: ${sourceCommit}`,
    );
  }

  return sourceCommit;
}

export function readSourceDirty(projectRoot = DEFAULT_PROJECT_ROOT) {
  return Boolean(
    execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim(),
  );
}

export async function createCrateXBuildManifest(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const distDirectory = resolve(
    options.distDirectory ?? join(projectRoot, "dist-app"),
  );

  await assertDistDirectory(distDirectory);
  const regularFiles = await collectRegularFiles(distDirectory);
  regularFiles.sort((left, right) =>
    comparePaths(left.relativePath, right.relativePath),
  );

  const hashedFiles = [];
  for (const file of regularFiles) {
    hashedFiles.push([file.relativePath, await hashFile(file.absolutePath)]);
  }

  return {
    schemaVersion: 2,
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: readSourceCommit(projectRoot),
    sourceDirty: readSourceDirty(projectRoot),
    files: Object.fromEntries(hashedFiles),
  };
}

export function serializeCrateXBuildManifest(manifest) {
  const fileEntries = Object.entries(manifest.files).sort(([left], [right]) =>
    comparePaths(left, right),
  );
  const serializedFiles = fileEntries
    .map(
      ([relativePath, digest]) =>
        `    ${JSON.stringify(relativePath)}: ${JSON.stringify(digest)}`,
    )
    .join(",\n");
  const filesProperty = serializedFiles
    ? `"files": {\n${serializedFiles}\n  }`
    : '"files": {}';

  return [
    "{",
    `  "schemaVersion": ${manifest.schemaVersion},`,
    `  "sourceRepository": ${JSON.stringify(manifest.sourceRepository)},`,
    `  "sourceCommit": ${JSON.stringify(manifest.sourceCommit)},`,
    `  "sourceDirty": ${JSON.stringify(manifest.sourceDirty)},`,
    `  ${filesProperty}`,
    "}",
    "",
  ].join("\n");
}

export async function writeCrateXBuildManifest(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const distDirectory = resolve(
    options.distDirectory ?? join(projectRoot, "dist-app"),
  );
  const manifest = await createCrateXBuildManifest({
    projectRoot,
    distDirectory,
  });

  await writeFile(
    join(distDirectory, MANIFEST_FILENAME),
    serializeCrateXBuildManifest(manifest),
  );
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await writeCrateXBuildManifest();
}
