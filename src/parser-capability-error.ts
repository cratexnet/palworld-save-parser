export type PalworldParserCapabilityErrorCode =
  "unsupported_oodle_decoder" | "unsupported_gvas_parser";

export class PalworldParserCapabilityError extends Error {
  constructor(
    message: string,
    readonly code: PalworldParserCapabilityErrorCode,
  ) {
    super(message);
    this.name = "PalworldParserCapabilityError";
  }
}
