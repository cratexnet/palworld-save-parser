/// <reference lib="webworker" />

import { createPalworldV1SpeciesData } from "../../src/data/palworld-v1-species";
import { loadRequiredOozWasmPalworldOodleDecoder } from "../../src/ooz-wasm-decoder";
import {
  isCompactOwnedPalsPayload,
  type CompactOwnedPalsPayload,
} from "../../src/owned-pals-payload";
import { createPreparedOwnedPalsUploadWithGameData } from "../../src/prepared-owned-pals-upload";
import { parsePalworldSavHeader } from "../../src/save-file-header";

interface ParseSaveRequest {
  saveBuffer: ArrayBuffer;
}

type ParseSaveResponse =
  | { ok: true; prepared: CompactOwnedPalsPayload }
  | { ok: false; error: { code: string } };

const SAVE_PARSER_WORKER_FAILED_CODE = "save_parser_worker_failed";
const MAX_ERROR_CODE_LENGTH = 64;
const ERROR_CODE_PATTERN = /^[a-z0-9_]+$/;

const gameData = createPalworldV1SpeciesData();

self.addEventListener(
  "message",
  async (event: MessageEvent<ParseSaveRequest>) => {
    try {
      if (!(event.data?.saveBuffer instanceof ArrayBuffer)) {
        throw Object.assign(new Error("The worker request is invalid."), {
          code: "invalid_request",
        });
      }

      const saveBytes = new Uint8Array(event.data.saveBuffer);
      const header = parsePalworldSavHeader(saveBytes);
      const oodleDecoder =
        header.compression === "oodle"
          ? await loadRequiredOozWasmPalworldOodleDecoder()
          : undefined;
      const prepared = createPreparedOwnedPalsUploadWithGameData({
        saveBytes,
        gameData,
        ...(oodleDecoder ? { oodleDecoder } : {}),
      });
      if (!isCompactOwnedPalsPayload(prepared)) {
        throw Object.assign(
          new Error("The compact parser result exceeds its output limits."),
          { code: "save_limit_exceeded" },
        );
      }

      self.postMessage({ ok: true, prepared } satisfies ParseSaveResponse);
    } catch (error) {
      self.postMessage({
        ok: false,
        error: { code: getErrorCode(error) },
      } satisfies ParseSaveResponse);
    }
  },
);

function getErrorCode(error: unknown) {
  if (!(error instanceof Error)) return SAVE_PARSER_WORKER_FAILED_CODE;
  try {
    const code = (error as Error & { code?: unknown }).code;
    return typeof code === "string" &&
      code.length <= MAX_ERROR_CODE_LENGTH &&
      ERROR_CODE_PATTERN.test(code)
      ? code
      : SAVE_PARSER_WORKER_FAILED_CODE;
  } catch {
    return SAVE_PARSER_WORKER_FAILED_CODE;
  }
}
