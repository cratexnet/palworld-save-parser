#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_REPOSITORY = "https://github.com/cratexnet/palworld-save-parser";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

function readSourceCommit(projectRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .toLowerCase();
  } catch {
    return null;
  }
}

function readSourceDirty(projectRoot, sourceCommit) {
  if (!sourceCommit) return true;
  return Boolean(
    execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim(),
  );
}

function createSourceArchive(projectRoot, archivePath, sourceDirectoryName) {
  const sourceFileList = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: projectRoot,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(
      (relativePath) =>
        relativePath.length > 0 && existsSync(join(projectRoot, relativePath)),
    );
  const sourceFiles = Buffer.from(`${sourceFileList.join("\0")}\0`);
  if (sourceFileList.length === 0) {
    throw new Error(
      "No source files are available for the distribution archive.",
    );
  }

  execFileSync(
    "tar",
    [
      "--create",
      "--gzip",
      "--null",
      "--files-from=-",
      `--transform=s,^,${sourceDirectoryName}/,`,
      "--file",
      archivePath,
    ],
    {
      cwd: projectRoot,
      input: sourceFiles,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
}

async function hashFile(filePath) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export async function prepareAppDistribution(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const distDirectory = resolve(
    options.distDirectory ?? join(projectRoot, "dist-app"),
  );
  const sourceCommit = readSourceCommit(projectRoot);
  const sourceDirty = readSourceDirty(projectRoot, sourceCommit);
  const sourceRef = sourceCommit ?? "working-tree";
  const sourceDirectoryName = `palworld-save-parser-${sourceRef}`;
  const sourceArchiveRelativePath = `source/${sourceDirectoryName}.tar.gz`;
  const sourceArchivePath = join(distDirectory, sourceArchiveRelativePath);
  const licensesDirectory = join(distDirectory, "licenses");

  await mkdir(dirname(sourceArchivePath), { recursive: true });
  await mkdir(licensesDirectory, { recursive: true });
  await Promise.all([
    copyFile(join(projectRoot, "LICENSE"), join(distDirectory, "LICENSE")),
    copyFile(join(projectRoot, "COPYRIGHT"), join(distDirectory, "COPYRIGHT")),
    copyFile(
      join(projectRoot, "THIRD_PARTY_NOTICES.md"),
      join(distDirectory, "THIRD_PARTY_NOTICES.md"),
    ),
    copyFile(
      join(projectRoot, "src/data/palworld-v1.LICENSE.txt"),
      join(licensesDirectory, "palworld-v1.MIT.txt"),
    ),
    copyFile(
      join(projectRoot, "vendor/palworld-ooz/LICENSE"),
      join(licensesDirectory, "palworld-ooz.GPL-3.0-or-later.txt"),
    ),
    copyFile(
      join(projectRoot, "node_modules/fflate/LICENSE"),
      join(licensesDirectory, "fflate.MIT.txt"),
    ),
  ]);

  createSourceArchive(projectRoot, sourceArchivePath, sourceDirectoryName);
  const sourceArchiveSha256 = await hashFile(sourceArchivePath);

  const sourceManifest = {
    schemaVersion: 1,
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit,
    sourceDirty,
    license: "GPL-3.0-or-later",
    sourceArchive: `./${sourceArchiveRelativePath}`,
    sourceArchiveSha256,
    ...(sourceCommit
      ? { sourceUrl: `${SOURCE_REPOSITORY}/tree/${sourceCommit}` }
      : { sourceUrl: SOURCE_REPOSITORY }),
  };
  await writeFile(
    join(distDirectory, "cratex-source.json"),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
  );
  await writeFile(
    join(distDirectory, "THIRD_PARTY_LICENSES.txt"),
    [
      "Palworld Save Parser browser distribution licenses",
      "",
      "- Main program: GPL-3.0-or-later (./LICENSE)",
      "- Palworld Ooz decoder: GPL-3.0-or-later (./licenses/palworld-ooz.GPL-3.0-or-later.txt)",
      "- fflate: MIT (./licenses/fflate.MIT.txt)",
      "- Palworld species IDs: MIT (./licenses/palworld-v1.MIT.txt)",
      "",
      "Complete notices: ./THIRD_PARTY_NOTICES.md",
      `Complete corresponding source: ./${sourceArchiveRelativePath}`,
      `Source repository: ${SOURCE_REPOSITORY}`,
      "",
    ].join("\n"),
  );

  return {
    ...sourceManifest,
    sourceArchiveFilename: basename(sourceArchivePath),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await prepareAppDistribution();
}
