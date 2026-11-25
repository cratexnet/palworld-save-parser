import { isCompactOwnedPalsPayload } from "./owned-pals-payload";
import type { CompactOwnedPalsPayload } from "./owned-pals-payload";

export const PALWORLD_SAVE_PARSER_CHANNEL = "palworld-save-parser" as const;
export const PALWORLD_SAVE_PARSER_PROTOCOL_VERSION = 1 as const;
export const PALWORLD_SAVE_PARSER_MAX_REQUEST_ID_LENGTH = 128;

export interface PalworldSaveParserLimits {
  readonly maxFileBytes: number;
  readonly maxCompressedBytes: number;
  readonly maxUncompressedBytes: number;
  readonly maxExpansionRatio: number;
  readonly timeoutMs: number;
}

interface ProtocolEnvelope {
  readonly channel: typeof PALWORLD_SAVE_PARSER_CHANNEL;
  readonly v: typeof PALWORLD_SAVE_PARSER_PROTOCOL_VERSION;
}

export interface PalworldSaveParserParseRequest extends ProtocolEnvelope {
  readonly type: "parse";
  readonly requestId: string;
  readonly file: File;
}

export interface PalworldSaveParserCancelRequest extends ProtocolEnvelope {
  readonly type: "cancel";
  readonly requestId: string;
}

export type PalworldSaveParserRequest =
  PalworldSaveParserParseRequest | PalworldSaveParserCancelRequest;

export type PalworldSaveParserErrorCode =
  | "invalid_request"
  | "file_too_large"
  | "save_limit_exceeded"
  | "invalid_save"
  | "unsupported_save"
  | "file_read_failed"
  | "parser_unavailable"
  | "timeout"
  | "cancelled"
  | "internal_error";

export interface PalworldSaveParserReadyResponse extends ProtocolEnvelope {
  readonly type: "ready";
  readonly limits: PalworldSaveParserLimits;
}

export interface PalworldSaveParserResultResponse extends ProtocolEnvelope {
  readonly type: "result";
  readonly requestId: string;
  readonly prepared: CompactOwnedPalsPayload;
}

export interface PalworldSaveParserErrorResponse extends ProtocolEnvelope {
  readonly type: "error";
  readonly requestId: string;
  readonly code: PalworldSaveParserErrorCode;
}

export type PalworldSaveParserResponse =
  | PalworldSaveParserReadyResponse
  | PalworldSaveParserResultResponse
  | PalworldSaveParserErrorResponse;

const ERROR_CODES: Readonly<Record<PalworldSaveParserErrorCode, true>> = {
  invalid_request: true,
  file_too_large: true,
  save_limit_exceeded: true,
  invalid_save: true,
  unsupported_save: true,
  file_read_failed: true,
  parser_unavailable: true,
  timeout: true,
  cancelled: true,
  internal_error: true,
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const COMPACT_ROW_KEYS: Readonly<Record<string, true>> = {
  i: true,
  s: true,
  g: true,
  p: true,
  l: true,
};

export function isPalworldSaveParserRequest(
  value: unknown,
): value is PalworldSaveParserRequest {
  if (!hasEnvelope(value) || !isRequestId(value.requestId)) return false;

  if (value.type === "parse") {
    return (
      hasExactKeys(value, ["channel", "v", "type", "requestId", "file"]) &&
      isFile(value.file)
    );
  }
  if (value.type === "cancel") {
    return hasExactKeys(value, ["channel", "v", "type", "requestId"]);
  }
  return false;
}

export function isPalworldSaveParserResponse(
  value: unknown,
): value is PalworldSaveParserResponse {
  if (!hasEnvelope(value)) return false;

  if (value.type === "ready") {
    return (
      hasExactKeys(value, ["channel", "v", "type", "limits"]) &&
      isLimits(value.limits)
    );
  }
  if (value.type === "result") {
    return (
      hasExactKeys(value, ["channel", "v", "type", "requestId", "prepared"]) &&
      isRequestId(value.requestId) &&
      isStrictCompactOwnedPalsPayload(value.prepared)
    );
  }
  if (value.type === "error") {
    return (
      hasExactKeys(value, ["channel", "v", "type", "requestId", "code"]) &&
      isRequestId(value.requestId) &&
      typeof value.code === "string" &&
      ERROR_CODES[value.code as PalworldSaveParserErrorCode] === true
    );
  }
  return false;
}

export function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= PALWORLD_SAVE_PARSER_MAX_REQUEST_ID_LENGTH &&
    REQUEST_ID_PATTERN.test(value)
  );
}

export function hasPalworldSaveParserEnvelope(
  value: unknown,
): value is Record<string, unknown> & ProtocolEnvelope {
  return hasEnvelope(value);
}

function hasEnvelope(
  value: unknown,
): value is Record<string, unknown> & ProtocolEnvelope {
  return (
    isRecord(value) &&
    value.channel === PALWORLD_SAVE_PARSER_CHANNEL &&
    value.v === PALWORLD_SAVE_PARSER_PROTOCOL_VERSION
  );
}

function isLimits(value: unknown): value is PalworldSaveParserLimits {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "maxFileBytes",
      "maxCompressedBytes",
      "maxUncompressedBytes",
      "maxExpansionRatio",
      "timeoutMs",
    ]) &&
    isPositiveSafeInteger(value.maxFileBytes) &&
    isPositiveSafeInteger(value.maxCompressedBytes) &&
    isPositiveSafeInteger(value.maxUncompressedBytes) &&
    isPositiveSafeInteger(value.maxExpansionRatio) &&
    isPositiveSafeInteger(value.timeoutMs)
  );
}

function isStrictCompactOwnedPalsPayload(
  value: unknown,
): value is CompactOwnedPalsPayload {
  return (
    isCompactOwnedPalsPayload(value) &&
    isRecord(value) &&
    hasExactKeys(value, ["v", "pals"]) &&
    value.pals.every(
      (row, index) =>
        isRecord(row) &&
        hasOnlyKeys(row, COMPACT_ROW_KEYS) &&
        hasOwn(row, "i") &&
        hasOwn(row, "s") &&
        row.i === `pal-${index + 1}`,
    )
  );
}

function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => hasOwn(value, key))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: Readonly<Record<string, true>>,
) {
  return Object.keys(value).every((key) => allowed[key] === true);
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
