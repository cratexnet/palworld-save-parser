export const PALWORLD_SAVE_PARSER_ERROR_CODES = [
  "invalid_request",
  "invalid_save",
  "invalid_save_header",
  "save_limit_exceeded",
  "decompression_failed",
  "decompressed_size_mismatch",
  "oodle_decode_failed",
  "oodle_size_mismatch",
  "unsupported_oodle_decoder",
  "unsupported_gvas_parser",
  "invalid_gvas",
  "invalid_raw_character_data",
  "save_parser_timeout",
  "save_parser_aborted",
  "save_file_read_failed",
  "save_parser_worker_failed",
  "save_parser_worker_unavailable",
] as const;

export type PalworldSaveParserErrorCode =
  (typeof PALWORLD_SAVE_PARSER_ERROR_CODES)[number];

export function getPalworldSaveParserErrorCode(
  error: unknown,
): PalworldSaveParserErrorCode {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === "string" && isPalworldSaveParserErrorCode(code)) {
      return code;
    }
    if (error.name === "PalworldGvasExtractError") return "invalid_gvas";
    if (error.name === "PalworldRawCharacterDecodeError") {
      return "invalid_raw_character_data";
    }
  }
  return "invalid_save";
}

export function isPalworldSaveParserErrorCode(
  value: string,
): value is PalworldSaveParserErrorCode {
  return (PALWORLD_SAVE_PARSER_ERROR_CODES as readonly string[]).includes(
    value,
  );
}
