import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPalworldSaveParserIframeBridge,
  derivePalworldSaveParserParentOrigin,
} from "./iframe-bridge";
import type {
  IframeBridgeParent,
  IframeBridgeWindow,
  ParsePalworldSaveFile,
} from "./iframe-bridge";
import {
  PALWORLD_SAVE_PARSER_CHANNEL,
  PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
} from "./post-message-contract";
import type { PalworldSaveParserLimits } from "./post-message-contract";
import type { CompactOwnedPalsPayload } from "./owned-pals-payload";

declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve(value: T | PromiseLike<T>): void;
      reject(reason?: unknown): void;
    };
  }
}

const PARENT_ORIGIN = "https://cratex.app";
const LIMITS: PalworldSaveParserLimits = {
  maxFileBytes: 128 * 1024 * 1024,
  maxCompressedBytes: 128 * 1024 * 1024,
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxExpansionRatio: 128,
  timeoutMs: 60_000,
};
const PREPARED: CompactOwnedPalsPayload = {
  v: 1,
  pals: [{ i: "pal-1", s: "SheepBall" }],
};

class FakeWindow implements IframeBridgeWindow {
  readonly parent: IframeBridgeParent;
  private readonly listeners = new Set<
    (event: MessageEvent<unknown>) => void
  >();

  constructor(readonly postMessage = vi.fn()) {
    this.parent = { postMessage };
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    this.listeners.delete(listener);
  }

  emit(data: unknown, origin = PARENT_ORIGIN, source: unknown = this.parent) {
    const event = { data, origin, source } as MessageEvent<unknown>;
    for (const listener of this.listeners) listener(event);
  }
}

function parseRequest(
  requestId: string,
  file = new File(["save"], "Level.sav"),
) {
  return {
    channel: PALWORLD_SAVE_PARSER_CHANNEL,
    v: PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
    type: "parse" as const,
    requestId,
    file,
  };
}

function cancelRequest(requestId: string) {
  return {
    channel: PALWORLD_SAVE_PARSER_CHANNEL,
    v: PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
    type: "cancel" as const,
    requestId,
  };
}

function startBridge(host: FakeWindow, parseFile: ParsePalworldSaveFile) {
  const bridge = createPalworldSaveParserIframeBridge({
    window: host,
    parentOrigin: PARENT_ORIGIN,
    limits: LIMITS,
    parseFile,
  });
  bridge.start();
  host.postMessage.mockClear();
  return bridge;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("derivePalworldSaveParserParentOrigin", () => {
  it("derives only the exact HTTP origin from the referrer", () => {
    expect(
      derivePalworldSaveParserParentOrigin(
        "https://cratex.app/tools/palworld?x=1",
      ),
    ).toBe(PARENT_ORIGIN);
    expect(() =>
      derivePalworldSaveParserParentOrigin("data:text/html,test"),
    ).toThrow();
    expect(() => derivePalworldSaveParserParentOrigin("")).toThrow();
  });
});

describe("createPalworldSaveParserIframeBridge", () => {
  it("posts ready limits only to the derived parent origin", () => {
    const host = new FakeWindow();
    const bridge = createPalworldSaveParserIframeBridge({
      window: host,
      referrer: "https://cratex.app/tools/palworld",
      limits: LIMITS,
      parseFile: vi.fn(),
    });

    bridge.start();

    expect(host.postMessage).toHaveBeenCalledOnce();
    expect(host.postMessage).toHaveBeenCalledWith(
      {
        channel: PALWORLD_SAVE_PARSER_CHANNEL,
        v: PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
        type: "ready",
        limits: LIMITS,
      },
      PARENT_ORIGIN,
    );
    bridge.dispose();
  });

  it("ignores valid-looking messages with a forged origin or source", () => {
    const host = new FakeWindow();
    const parseFile = vi.fn<ParsePalworldSaveFile>();
    const bridge = startBridge(host, parseFile);
    const request = parseRequest("request-1");

    host.emit(request, "https://attacker.example");
    host.emit(request, PARENT_ORIGIN, { postMessage: vi.fn() });

    expect(parseFile).not.toHaveBeenCalled();
    expect(host.postMessage).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("rejects a malformed trusted request without echoing unbounded IDs", () => {
    const host = new FakeWindow();
    const parseFile = vi.fn<ParsePalworldSaveFile>();
    const bridge = startBridge(host, parseFile);

    host.emit({
      ...parseRequest("request-1"),
      rawSaveBytes: new Uint8Array([1, 2, 3]),
    });
    host.emit({ ...cancelRequest("x".repeat(129)), unexpected: true });

    expect(parseFile).not.toHaveBeenCalled();
    expect(host.postMessage).toHaveBeenCalledOnce();
    expect(host.postMessage).toHaveBeenCalledWith(
      {
        channel: PALWORLD_SAVE_PARSER_CHANNEL,
        v: PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
        type: "error",
        requestId: "request-1",
        code: "invalid_request",
      },
      PARENT_ORIGIN,
    );
    bridge.dispose();
  });

  it("aborts and acknowledges cancellation of the active request", async () => {
    const host = new FakeWindow();
    let signal: AbortSignal | undefined;
    let resolveParse: ((payload: CompactOwnedPalsPayload) => void) | undefined;
    const parseFile: ParsePalworldSaveFile = (_file, options) => {
      signal = options.signal;
      const deferred = Promise.withResolvers<CompactOwnedPalsPayload>();
      resolveParse = deferred.resolve;
      return deferred.promise;
    };
    const bridge = startBridge(host, parseFile);

    host.emit(parseRequest("request-1"));
    host.emit(cancelRequest("request-1"));
    resolveParse?.(PREPARED);
    await flushPromises();

    expect(signal?.aborted).toBe(true);
    expect(host.postMessage).toHaveBeenCalledTimes(1);
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        requestId: "request-1",
        code: "cancelled",
      }),
      PARENT_ORIGIN,
    );
    bridge.dispose();
  });

  it("supersedes the active parse and suppresses its stale completion", async () => {
    const host = new FakeWindow();
    const pending: Array<{
      signal: AbortSignal;
      resolve: (payload: CompactOwnedPalsPayload) => void;
    }> = [];
    const parseFile: ParsePalworldSaveFile = (_file, options) => {
      const deferred = Promise.withResolvers<CompactOwnedPalsPayload>();
      pending.push({ signal: options.signal, resolve: deferred.resolve });
      return deferred.promise;
    };
    const bridge = startBridge(host, parseFile);

    host.emit(parseRequest("request-1"));
    host.emit(parseRequest("request-2"));
    expect(pending[0].signal.aborted).toBe(true);

    pending[1].resolve(PREPARED);
    pending[0].resolve({ v: 1, pals: [{ i: "pal-2", s: "SecretSpecies" }] });
    await flushPromises();

    expect(host.postMessage).toHaveBeenCalledTimes(1);
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "result",
        requestId: "request-2",
        prepared: PREPARED,
      }),
      PARENT_ORIGIN,
    );
    expect(JSON.stringify(host.postMessage.mock.calls)).not.toContain(
      "SecretSpecies",
    );
    bridge.dispose();
  });

  it("posts only a stable error code when parsing exposes a secret message and stack", async () => {
    const host = new FakeWindow();
    const secret = "private/player/path/Level.sav";
    const parseFile: ParsePalworldSaveFile = async () => {
      const error = new Error(secret);
      error.stack = `stack containing ${secret}`;
      throw error;
    };
    const bridge = startBridge(host, parseFile);

    host.emit(parseRequest("request-1"));
    await flushPromises();

    expect(host.postMessage).toHaveBeenCalledWith(
      {
        channel: PALWORLD_SAVE_PARSER_CHANNEL,
        v: PALWORLD_SAVE_PARSER_PROTOCOL_VERSION,
        type: "error",
        requestId: "request-1",
        code: "internal_error",
      },
      PARENT_ORIGIN,
    );
    const serializedPosts = JSON.stringify(host.postMessage.mock.calls);
    expect(serializedPosts).not.toContain(secret);
    expect(serializedPosts).not.toContain("message");
    expect(serializedPosts).not.toContain("stack");
    bridge.dispose();
  });

  it("aborts at the advertised 60 second limit and suppresses later completion", async () => {
    vi.useFakeTimers();
    const host = new FakeWindow();
    let signal: AbortSignal | undefined;
    let resolveParse: ((payload: CompactOwnedPalsPayload) => void) | undefined;
    const parseFile: ParsePalworldSaveFile = (_file, options) => {
      signal = options.signal;
      const deferred = Promise.withResolvers<CompactOwnedPalsPayload>();
      resolveParse = deferred.resolve;
      return deferred.promise;
    };
    const bridge = startBridge(host, parseFile);

    host.emit(parseRequest("request-timeout"));
    await vi.advanceTimersByTimeAsync(60_000);
    resolveParse?.(PREPARED);
    await flushPromises();

    expect(signal?.aborted).toBe(true);
    expect(host.postMessage).toHaveBeenCalledTimes(1);
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        requestId: "request-timeout",
        code: "timeout",
      }),
      PARENT_ORIGIN,
    );
    bridge.dispose();
  });
});
