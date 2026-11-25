import { PalworldParserCapabilityError } from "./parser-capability-error";
import { createCompactOwnedPalsPayloadFromExtractRows } from "./extracted-inventory-payload";
import type { PalworldSpeciesData } from "./game-data-contract";
import type { CompactOwnedPalsPayload } from "./owned-pals-payload";
import type { PalworldSavDecompressionOptions } from "./save-decompression";
import { inspectPalworldLocalSave } from "./save-parser-contract";

export type PreparedOwnedPalsUpload = CompactOwnedPalsPayload;

export interface CreatePreparedOwnedPalsUploadWithGameDataInput extends PalworldSavDecompressionOptions {
  saveBytes: Uint8Array;
  gameData: PalworldSpeciesData;
}

export function createPreparedOwnedPalsUploadWithGameData(
  input: CreatePreparedOwnedPalsUploadWithGameDataInput,
): PreparedOwnedPalsUpload {
  const parsed = inspectPalworldLocalSave(input.saveBytes, {
    oodleDecoder: input.oodleDecoder,
  });

  if (parsed.status === "blocked") {
    throw new PalworldParserCapabilityError(
      `Palworld save parsing is blocked: ${parsed.blocker}.`,
      parsed.blocker,
    );
  }

  return createCompactOwnedPalsPayloadFromExtractRows({
    rows: parsed.rows,
    gameData: input.gameData,
  }).payload;
}
