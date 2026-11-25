import type { PalworldExtractedInventoryRow } from "./extracted-inventory-payload";
import {
  decompressPalworldSavPayload,
  type PalworldSavDecompressionOptions,
} from "./save-decompression";
import {
  parsePalworldSavHeader,
  type PalworldSavHeader,
} from "./save-file-header";
import { extractPalworldOwnedPalsFromGvasPayload } from "./save-gvas-extractor";

export type PalworldLocalSaveParserBlocker =
  "unsupported_oodle_decoder" | "unsupported_gvas_parser";

export interface PalworldLocalSaveParserBlockedResult {
  status: "blocked";
  blocker: PalworldLocalSaveParserBlocker;
  header: PalworldSavHeader;
}

export interface PalworldLocalSaveParserParsedResult {
  status: "parsed";
  header: PalworldSavHeader;
  rows: readonly PalworldExtractedInventoryRow[];
}

export type PalworldLocalSaveParserResult =
  PalworldLocalSaveParserBlockedResult | PalworldLocalSaveParserParsedResult;

export type PalworldGvasInventoryExtractor = (
  payload: Uint8Array,
  header: PalworldSavHeader,
) => readonly PalworldExtractedInventoryRow[];

export interface PalworldLocalSaveParserOptions extends PalworldSavDecompressionOptions {
  gvasExtractor?: PalworldGvasInventoryExtractor;
}

export function inspectPalworldLocalSave(
  data: Uint8Array,
  options: PalworldLocalSaveParserOptions = {},
): PalworldLocalSaveParserResult {
  const header = parsePalworldSavHeader(data);

  if (header.compression === "oodle" && !options.oodleDecoder) {
    return {
      status: "blocked",
      blocker: "unsupported_oodle_decoder",
      header,
    };
  }

  const decompressed = decompressPalworldSavPayload(data, options);
  return {
    status: "parsed",
    header: decompressed.header,
    rows: (options.gvasExtractor ?? extractPalworldOwnedPalsFromGvasPayload)(
      decompressed.payload,
      decompressed.header,
    ),
  };
}
