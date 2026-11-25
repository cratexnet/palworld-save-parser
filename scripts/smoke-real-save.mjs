#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import {
  assertPalworldSaveFileSize,
  createPalworldV1SpeciesData,
  createPreparedOwnedPalsUploadWithGameData,
  PALWORLD_V1_SPECIES_DATA_VERSION,
  parsePalworldSavHeader,
} from "palworld-save-parser";
import { loadOozWasmPalworldOodleDecoder } from "palworld-save-parser/ooz-wasm";

const savePath = process.argv.slice(2).find((argument) => argument !== "--");

if (!savePath) {
  console.error("Usage: pnpm smoke:real-save -- /path/to/Level.sav");
  process.exit(64);
}

const file = await stat(savePath);
assertPalworldSaveFileSize(file.size);
const saveBytes = new Uint8Array(await readFile(savePath));
const header = parsePalworldSavHeader(saveBytes);
const oodleDecoder =
  header.compression === "oodle"
    ? await loadOozWasmPalworldOodleDecoder()
    : undefined;
const prepared = createPreparedOwnedPalsUploadWithGameData({
  saveBytes,
  gameData: createPalworldV1SpeciesData(),
  ...(oodleDecoder ? { oodleDecoder } : {}),
});
const allowedKeys = ["i", "s", "g", "p", "l"];

console.log(
  JSON.stringify(
    {
      status: "parsed",
      compression: header.compression,
      compressedBytes: header.compressedBytes,
      uncompressedBytes: header.uncompressedBytes,
      speciesDataVersion: PALWORLD_V1_SPECIES_DATA_VERSION,
      payloadVersion: prepared.v,
      compactPals: prepared.pals.length,
      anonymousIdsOnly: prepared.pals.every(
        (pal, index) => pal.i === `pal-${index + 1}`,
      ),
      compactFieldsOnly: prepared.pals.every((pal) =>
        Object.keys(pal).every((key) => allowedKeys.includes(key)),
      ),
    },
    null,
    2,
  ),
);
