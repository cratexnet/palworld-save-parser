import type { CompactOwnedPalsPayload } from "./owned-pals-payload";
import {
  PALWORLD_SAVE_PARSER_CHANNEL,
  PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
  hasPalworldSaveParserEnvelope,
  isPalworldSaveParserRequest,
  isPalworldSaveParserResponse,
  isRequestId,
} from "./post-message-contract";
import type {
  PalworldSaveParserErrorCode,
  PalworldSaveParserLimits,
  PalworldSaveParserParseRequest,
  PalworldSaveParserResponse,
} from "./post-message-contract";

export interface PalworldSaveParseOptions {
  readonly signal: AbortSignal;
}

export type ParsePalworldSaveFile = (
  file: File,
  options: PalworldSaveParseOptions,
) => Promise<CompactOwnedPalsPayload>;

export interface IframeBridgeWindow {
  readonly parent: IframeBridgeParent;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
}

export interface IframeBridgeParent {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface CreatePalworldSaveParserIframeBridgeOptions {
  readonly parseFile: ParsePalworldSaveFile;
  readonly limits: PalworldSaveParserLimits;
  readonly parentOrigin?: string;
  readonly referrer?: string;
  readonly window?: IframeBridgeWindow;
}

export interface PalworldSaveParserIframeBridge {
  start(): void;
  dispose(): void;
}

interface ActiveParse {
  readonly requestId: string;
  readonly controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout> | undefined;
}

const INTERNAL_ERROR_CODES: Readonly<
  Record<string, PalworldSaveParserErrorCode>
> = {
  invalid_save: "invalid_save",
  invalid_save_header: "invalid_save",
  decompression_failed: "invalid_save",
  decompressed_size_mismatch: "invalid_save",
  oodle_decode_failed: "invalid_save",
  oodle_size_mismatch: "invalid_save",
  invalid_gvas: "invalid_save",
  invalid_raw_character_data: "invalid_save",
  unsupported_oodle_decoder: "unsupported_save",
  unsupported_gvas_parser: "unsupported_save",
  save_file_read_failed: "file_read_failed",
  save_parser_worker_unavailable: "parser_unavailable",
  save_parser_worker_failed: "internal_error",
  save_parser_timeout: "timeout",
  save_parser_aborted: "cancelled",
  save_limit_exceeded: "save_limit_exceeded",
};

export function derivePalworldSaveParserParentOrigin(referrer: string): string {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    throw new Error("A valid parent referrer is required.");
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.origin === "null"
  ) {
    throw new Error("The parent referrer must have an HTTP origin.");
  }
  return url.origin;
}

export function createPalworldSaveParserIframeBridge(
  options: CreatePalworldSaveParserIframeBridgeOptions,
): PalworldSaveParserIframeBridge {
  const host = options.window ?? (window as unknown as IframeBridgeWindow);
  const parent = host.parent;
  const parentOrigin = options.parentOrigin
    ? normalizeParentOrigin(options.parentOrigin)
    : derivePalworldSaveParserParentOrigin(
        options.referrer ?? document.referrer,
      );

  let active: ActiveParse | undefined;
  let started = false;

  const post = (response: PalworldSaveParserResponse) => {
    if (!isPalworldSaveParserResponse(response)) {
      throw new Error("Refusing to post an invalid parser response.");
    }
    parent.postMessage(response, parentOrigin);
  };

  const finish = (operation: ActiveParse) => {
    if (operation.timeoutId !== undefined) {
      clearTimeout(operation.timeoutId);
      operation.timeoutId = undefined;
    }
    if (active === operation) active = undefined;
  };

  const postError = (requestId: string, code: PalworldSaveParserErrorCode) => {
    post({
      channel: PALWORLD_SAVE_PARSER_CHANNEL,
      v: PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
      type: "error",
      requestId,
      code,
    });
  };

  const handleParse = (request: PalworldSaveParserParseRequest) => {
    const superseded = active;
    if (superseded) {
      finish(superseded);
      superseded.controller.abort();
    }

    if (request.file.size > options.limits.maxFileBytes) {
      postError(request.requestId, "file_too_large");
      return;
    }

    const operation: ActiveParse = {
      requestId: request.requestId,
      controller: new AbortController(),
      timeoutId: undefined,
    };
    active = operation;
    operation.timeoutId = setTimeout(() => {
      if (active !== operation) return;
      finish(operation);
      operation.controller.abort();
      postError(operation.requestId, "timeout");
    }, options.limits.timeoutMs);

    void (async () => {
      try {
        const prepared = await options.parseFile(request.file, {
          signal: operation.controller.signal,
        });
        if (active !== operation || operation.controller.signal.aborted) return;

        const response: PalworldSaveParserResponse = {
          channel: PALWORLD_SAVE_PARSER_CHANNEL,
          v: PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
          type: "result",
          requestId: request.requestId,
          prepared,
        };
        if (!isPalworldSaveParserResponse(response)) {
          throw new Error("The parser returned an invalid compact payload.");
        }
        finish(operation);
        parent.postMessage(response, parentOrigin);
      } catch (error) {
        if (active !== operation || operation.controller.signal.aborted) return;
        finish(operation);
        postError(request.requestId, classifyParserError(error));
      }
    })();
  };

  const handleMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== parent || event.origin !== parentOrigin) return;

    if (!isPalworldSaveParserRequest(event.data)) {
      if (
        hasPalworldSaveParserEnvelope(event.data) &&
        isRequestId(event.data.requestId)
      ) {
        postError(event.data.requestId, "invalid_request");
      }
      return;
    }

    if (event.data.type === "parse") {
      handleParse(event.data);
      return;
    }

    if (active?.requestId !== event.data.requestId) return;
    const cancelled = active;
    finish(cancelled);
    cancelled.controller.abort();
    postError(cancelled.requestId, "cancelled");
  };

  return {
    start() {
      if (started) return;
      const ready: PalworldSaveParserResponse = {
        channel: PALWORLD_SAVE_PARSER_CHANNEL,
        v: PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
        type: "ready",
        limits: options.limits,
      };
      if (!isPalworldSaveParserResponse(ready)) {
        throw new Error("Parser limits are invalid.");
      }

      host.addEventListener("message", handleMessage);
      started = true;
      try {
        parent.postMessage(ready, parentOrigin);
      } catch (error) {
        host.removeEventListener("message", handleMessage);
        started = false;
        throw error;
      }
    },
    dispose() {
      if (started) {
        host.removeEventListener("message", handleMessage);
        started = false;
      }
      if (!active) return;
      const disposed = active;
      finish(disposed);
      disposed.controller.abort();
    },
  };
}

function normalizeParentOrigin(origin: string): string {
  const normalized = derivePalworldSaveParserParentOrigin(origin);
  if (origin !== normalized) {
    throw new Error("The injected parent origin must be an exact origin.");
  }
  return normalized;
}

function classifyParserError(error: unknown): PalworldSaveParserErrorCode {
  if (error === null || typeof error !== "object") return "internal_error";

  if ("code" in error && typeof error.code === "string") {
    const classified = INTERNAL_ERROR_CODES[error.code];
    if (classified) return classified;
  }
  if (
    "name" in error &&
    (error.name === "PalworldGvasExtractError" ||
      error.name === "PalworldRawCharacterDecodeError")
  ) {
    return "invalid_save";
  }
  return "internal_error";
}
