import { describe, expect, it } from "vitest";
import {
  PALWORLD_SAVE_PARSER_CHANNEL,
  PALWORLD_SAVE_PARSER_MAX_REQUEST_ID_LENGTH,
  PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
  isPalworldSaveParserRequest,
  isPalworldSaveParserResponse,
  isRequestId,
} from "./post-message-contract";
import type { PalworldSaveParserLimits } from "./post-message-contract";

const ENVELOPE = {
  channel: PALWORLD_SAVE_PARSER_CHANNEL,
  v: PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
} as const;
const LIMITS: PalworldSaveParserLimits = {
  maxFileBytes: 128 * 1024 * 1024,
  maxCompressedBytes: 128 * 1024 * 1024,
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxExpansionRatio: 128,
  timeoutMs: 60_000,
};

describe("isRequestId", () => {
  it("accepts bounded opaque ASCII IDs used by the parent", () => {
    expect(isRequestId("parse:018f.test-1_A")).toBe(true);
    expect(
      isRequestId("a".repeat(PALWORLD_SAVE_PARSER_MAX_REQUEST_ID_LENGTH)),
    ).toBe(true);
  });

  it("rejects empty, oversized, whitespace, control, and non-string IDs", () => {
    expect(isRequestId("")).toBe(false);
    expect(
      isRequestId("a".repeat(PALWORLD_SAVE_PARSER_MAX_REQUEST_ID_LENGTH + 1)),
    ).toBe(false);
    expect(isRequestId("request id")).toBe(false);
    expect(isRequestId("request\n1")).toBe(false);
    expect(isRequestId(1)).toBe(false);
  });
});

describe("isPalworldSaveParserRequest", () => {
  it("accepts only the exact v1 parse and cancel discriminants", () => {
    expect(
      isPalworldSaveParserRequest({
        ...ENVELOPE,
        type: "parse",
        requestId: "request-1",
        file: new File(["save"], "Level.sav"),
      }),
    ).toBe(true);
    expect(
      isPalworldSaveParserRequest({
        ...ENVELOPE,
        type: "cancel",
        requestId: "request-1",
      }),
    ).toBe(true);
  });

  it("rejects wrong versions, non-File payloads, and undeclared fields", () => {
    expect(
      isPalworldSaveParserRequest({
        ...ENVELOPE,
        v: 2,
        type: "cancel",
        requestId: "request-1",
      }),
    ).toBe(false);
    expect(
      isPalworldSaveParserRequest({
        ...ENVELOPE,
        type: "parse",
        requestId: "request-1",
        file: new Uint8Array([1, 2, 3]),
      }),
    ).toBe(false);
    expect(
      isPalworldSaveParserRequest({
        ...ENVELOPE,
        type: "cancel",
        requestId: "request-1",
        fileName: "Level.sav",
      }),
    ).toBe(false);
  });
});

describe("isPalworldSaveParserResponse", () => {
  it("validates ready, compact result, and stable error responses", () => {
    expect(
      isPalworldSaveParserResponse({
        ...ENVELOPE,
        type: "ready",
        limits: LIMITS,
      }),
    ).toBe(true);
    expect(
      isPalworldSaveParserResponse({
        ...ENVELOPE,
        type: "result",
        requestId: "request-1",
        prepared: {
          v: 1,
          pals: [{ i: "pal-1", s: "SheepBall", g: "F", p: ["PassiveSkill"] }],
        },
      }),
    ).toBe(true);
    expect(
      isPalworldSaveParserResponse({
        ...ENVELOPE,
        type: "error",
        requestId: "request-1",
        code: "invalid_save",
      }),
    ).toBe(true);
  });

  it("rejects raw data, identity fields, free-form errors, and unknown codes", () => {
    const validResult = {
      ...ENVELOPE,
      type: "result",
      requestId: "request-1",
      prepared: { v: 1, pals: [{ i: "pal-1", s: "SheepBall" }] },
    };

    expect(
      isPalworldSaveParserResponse({
        ...validResult,
        rawSaveBytes: new Uint8Array([1, 2, 3]),
      }),
    ).toBe(false);
    expect(
      isPalworldSaveParserResponse({
        ...validResult,
        prepared: { v: 1, pals: [{ i: "real-save-guid", s: "SheepBall" }] },
      }),
    ).toBe(false);
    expect(
      isPalworldSaveParserResponse({
        ...validResult,
        prepared: {
          ...validResult.prepared,
          playerName: "private name",
          coordinates: [1, 2, 3],
        },
      }),
    ).toBe(false);
    expect(
      isPalworldSaveParserResponse({
        ...ENVELOPE,
        type: "error",
        requestId: "request-1",
        code: "invalid_save",
        message: "private path",
      }),
    ).toBe(false);
    expect(
      isPalworldSaveParserResponse({
        ...ENVELOPE,
        type: "error",
        requestId: "request-1",
        code: "database_failure",
      }),
    ).toBe(false);
  });

  it("requires every advertised limit to be a positive safe integer", () => {
    expect(
      isPalworldSaveParserResponse({
        ...ENVELOPE,
        type: "ready",
        limits: { ...LIMITS, timeoutMs: 0 },
      }),
    ).toBe(false);
    expect(
      isPalworldSaveParserResponse({
        ...ENVELOPE,
        type: "ready",
        limits: { ...LIMITS, extraLimit: 1 },
      }),
    ).toBe(false);
  });
});
