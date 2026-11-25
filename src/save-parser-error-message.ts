export type SaveParserErrorMessageKey =
  | "error.decompression"
  | "error.invalid_request"
  | "error.invalid_save"
  | "error.save_too_large"
  | "error.oodle"
  | "error.file_read_failed"
  | "error.parser_failed"
  | "error.parser_timeout"
  | "error.structure";

export function mapSaveParserErrorToMessageKey(
  error: unknown,
): SaveParserErrorMessageKey {
  const code = getErrorCode(error);
  if (code === "unsupported_oodle_decoder") return "error.oodle";
  if (code === "unsupported_gvas_parser") return "error.structure";
  if (code === "invalid_request") return "error.invalid_request";
  if (code === "save_limit_exceeded") return "error.save_too_large";
  if (code === "save_parser_timeout") return "error.parser_timeout";
  if (code === "save_file_read_failed") return "error.file_read_failed";
  if (
    code === "save_parser_worker_failed" ||
    code === "save_parser_worker_unavailable"
  ) {
    return "error.parser_failed";
  }

  if (!(error instanceof Error)) return "error.invalid_save";
  if (
    error.name === "PalworldGvasExtractError" ||
    error.name === "PalworldRawCharacterDecodeError"
  ) {
    return "error.structure";
  }
  if (
    error.name === "PalworldSavDecompressionError" ||
    /decompress|oodle|kraken/iu.test(error.message)
  ) {
    return "error.decompression";
  }
  return "error.invalid_save";
}

function getErrorCode(error: unknown) {
  if (!(error instanceof Error)) return null;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
