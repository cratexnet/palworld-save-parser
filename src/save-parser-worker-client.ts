import { isCompactOwnedPalsPayload } from "./owned-pals-payload";
import type { PreparedOwnedPalsUpload } from "./prepared-owned-pals-upload";
import { assertPalworldSaveFileSize } from "./save-file-header";

export const PALWORLD_SAVE_PARSE_TIMEOUT_MS = 60_000;

const SAVE_PARSER_FAILED_MESSAGE = "The save parser failed.";
const MAX_ERROR_CODE_LENGTH = 64;
const ERROR_CODE_PATTERN = /^[a-z0-9_]+$/;
const COMPACT_ROW_KEYS: Readonly<Record<string, true>> = {
  i: true,
  s: true,
  g: true,
  p: true,
  l: true,
};

interface ParseSaveRequest {
  saveBuffer: ArrayBuffer;
}

type ParseSaveResponse =
  | { ok: true; prepared: PreparedOwnedPalsUpload }
  | { ok: false; error: { code: string } };

export interface SaveParserWorker {
  addEventListener(
    type: "message" | "error",
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

export type PalworldSaveParserWorkerErrorCode =
  | "save_parser_timeout"
  | "save_parser_aborted"
  | "save_file_read_failed"
  | "save_parser_worker_failed"
  | "save_parser_worker_unavailable";

export class PalworldSaveParserWorkerError extends Error {
  constructor(
    message: string,
    readonly code: PalworldSaveParserWorkerErrorCode,
  ) {
    super(message);
    this.name = "PalworldSaveParserWorkerError";
  }
}

export interface ParsePalworldSaveInWorkerInput {
  saveBuffer: ArrayBuffer;
  createWorker: () => SaveParserWorker;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ReadPalworldSaveFileInput {
  file: Blob;
  signal?: AbortSignal;
  createFileReader?: () => FileReader;
}

export interface ParsePalworldSaveFileInWorkerInput extends Omit<
  ParsePalworldSaveInWorkerInput,
  "saveBuffer"
> {
  file: Blob;
  createFileReader?: () => FileReader;
}

export function readPalworldSaveFileAsArrayBuffer(
  input: ReadPalworldSaveFileInput,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(createAbortedError());
      return;
    }

    let reader: FileReader;
    try {
      reader = (input.createFileReader ?? (() => new FileReader()))();
    } catch {
      reject(createFileReadFailedError());
      return;
    }

    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", handleSignalAbort);
      reader.removeEventListener("load", handleLoad);
      reader.removeEventListener("error", handleReadError);
      reader.removeEventListener("abort", handleReaderAbort);
      callback();
    };
    const handleLoad = () => {
      finish(() => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(createFileReadFailedError());
        }
      });
    };
    const handleReadError = () => {
      finish(() => reject(createFileReadFailedError(reader.error)));
    };
    const handleReaderAbort = () => {
      finish(() => reject(createAbortedError()));
    };
    const handleSignalAbort = () => {
      try {
        reader.abort();
      } finally {
        finish(() => reject(createAbortedError()));
      }
    };

    reader.addEventListener("load", handleLoad);
    reader.addEventListener("error", handleReadError);
    reader.addEventListener("abort", handleReaderAbort);
    input.signal?.addEventListener("abort", handleSignalAbort, { once: true });
    if (input.signal?.aborted) {
      handleSignalAbort();
      return;
    }

    try {
      reader.readAsArrayBuffer(input.file);
    } catch (error) {
      finish(() =>
        reject(
          createFileReadFailedError(error instanceof Error ? error : null),
        ),
      );
    }
  });
}

export async function parsePalworldSaveFileInWorker(
  input: ParsePalworldSaveFileInWorkerInput,
): Promise<PreparedOwnedPalsUpload> {
  if (input.signal?.aborted) throw createAbortedError();
  assertPalworldSaveFileSize(input.file.size);

  const timeoutMs = input.timeoutMs ?? PALWORLD_SAVE_PARSE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  const handleInputAbort = () => controller.abort();
  input.signal?.addEventListener("abort", handleInputAbort, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const saveBuffer = await readPalworldSaveFileAsArrayBuffer({
      file: input.file,
      signal: controller.signal,
      createFileReader: input.createFileReader,
    });
    return await parsePalworldSaveInWorker({
      saveBuffer,
      createWorker: input.createWorker,
      signal: controller.signal,
      timeoutMs: Math.max(0, deadline - Date.now()),
    });
  } catch (error) {
    if (timedOut || getErrorCode(error) === "save_parser_timeout") {
      throw createTimeoutError();
    }
    if (input.signal?.aborted) throw createAbortedError();
    throw error;
  } finally {
    clearTimeout(timeoutId);
    input.signal?.removeEventListener("abort", handleInputAbort);
  }
}

export function parsePalworldSaveInWorker(
  input: ParsePalworldSaveInWorkerInput,
): Promise<PreparedOwnedPalsUpload> {
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(createAbortedError());
      return;
    }
    try {
      assertPalworldSaveFileSize(input.saveBuffer.byteLength);
    } catch (error) {
      reject(error);
      return;
    }

    let worker: SaveParserWorker;
    try {
      worker = input.createWorker();
    } catch {
      reject(
        new PalworldSaveParserWorkerError(
          "An isolated save parser worker is unavailable.",
          "save_parser_worker_unavailable",
        ),
      );
      return;
    }

    let settled = false;
    const timeoutId = setTimeout(() => {
      finish(() => reject(createTimeoutError()));
    }, input.timeoutMs ?? PALWORLD_SAVE_PARSE_TIMEOUT_MS);

    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      input.signal?.removeEventListener("abort", handleAbort);
      worker.terminate();
      callback();
    }

    function handleAbort() {
      finish(() => reject(createAbortedError()));
    }

    input.signal?.addEventListener("abort", handleAbort, { once: true });
    if (input.signal?.aborted) {
      handleAbort();
      return;
    }

    worker.addEventListener(
      "message",
      ((event: MessageEvent<unknown>) => {
        if (!isParseSaveResponse(event.data)) {
          finish(() =>
            reject(
              new PalworldSaveParserWorkerError(
                "The save parser worker returned an invalid response.",
                "save_parser_worker_failed",
              ),
            ),
          );
          return;
        }
        const response = event.data;
        finish(() => {
          if (response.ok) {
            resolve(response.prepared);
            return;
          }
          reject(
            Object.assign(new Error(SAVE_PARSER_FAILED_MESSAGE), {
              code: response.error.code,
            }),
          );
        });
      }) as EventListener,
      { once: true },
    );
    worker.addEventListener(
      "error",
      ((_: ErrorEvent) => {
        finish(() =>
          reject(
            new PalworldSaveParserWorkerError(
              "The save parser worker failed.",
              "save_parser_worker_failed",
            ),
          ),
        );
      }) as EventListener,
      { once: true },
    );

    try {
      const request: ParseSaveRequest = {
        saveBuffer: input.saveBuffer,
      };
      worker.postMessage(request, [input.saveBuffer]);
    } catch {
      finish(() =>
        reject(
          new PalworldSaveParserWorkerError(
            "The save could not be transferred to the parser worker.",
            "save_parser_worker_failed",
          ),
        ),
      );
    }
  });
}

function createAbortedError() {
  return new PalworldSaveParserWorkerError(
    "Palworld save parsing was cancelled.",
    "save_parser_aborted",
  );
}

function createTimeoutError() {
  return new PalworldSaveParserWorkerError(
    "Palworld save processing exceeded the time limit.",
    "save_parser_timeout",
  );
}

function createFileReadFailedError(error?: Error | null) {
  return new PalworldSaveParserWorkerError(
    error?.name === "NotReadableError"
      ? "The selected save file could not be read."
      : "The selected save file could not be loaded.",
    "save_file_read_failed",
  );
}

function getErrorCode(error: unknown) {
  if (!(error instanceof Error)) return null;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isParseSaveResponse(value: unknown): value is ParseSaveResponse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const response = value as Record<string, unknown>;
  if (response.ok === true) {
    return (
      hasExactKeys(response, ["ok", "prepared"]) &&
      isStrictCompactOwnedPalsPayload(response.prepared)
    );
  }
  if (
    response.ok !== false ||
    !hasExactKeys(response, ["ok", "error"]) ||
    response.error === null ||
    typeof response.error !== "object" ||
    Array.isArray(response.error)
  ) {
    return false;
  }
  const error = response.error as Record<string, unknown>;
  return hasExactKeys(error, ["code"]) && isWorkerErrorCode(error.code);
}

function isStrictCompactOwnedPalsPayload(
  value: unknown,
): value is PreparedOwnedPalsUpload {
  if (!isCompactOwnedPalsPayload(value)) return false;
  const payload = value as PreparedOwnedPalsUpload & Record<string, unknown>;
  return (
    hasExactKeys(payload, ["v", "pals"]) &&
    payload.pals.every((row, index) => {
      const record = row as unknown as Record<string, unknown>;
      return (
        Object.keys(record).every((key) => COMPACT_ROW_KEYS[key] === true) &&
        Object.prototype.hasOwnProperty.call(record, "i") &&
        Object.prototype.hasOwnProperty.call(record, "s") &&
        row.i === `pal-${index + 1}`
      );
    })
  );
}

function isWorkerErrorCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_ERROR_CODE_LENGTH &&
    ERROR_CODE_PATTERN.test(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
