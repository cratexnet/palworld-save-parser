import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parsePalworldSaveFileInWorker,
  parsePalworldSaveInWorker,
  PALWORLD_SAVE_PARSE_TIMEOUT_MS,
  readPalworldSaveFileAsArrayBuffer,
} from "./save-parser-worker-client";
import { PALWORLD_SAV_MAX_FILE_BYTES } from "./save-file-header";

class FakeSaveParserWorker {
  readonly messages: unknown[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  postMessageError?: Error;
  private messageListener?: (event: MessageEvent) => void;
  private errorListener?: (event: ErrorEvent) => void;

  addEventListener(type: "message" | "error", listener: EventListener): void {
    if (type === "message") {
      this.messageListener = listener as (event: MessageEvent) => void;
    } else {
      this.errorListener = listener as (event: ErrorEvent) => void;
    }
  }

  postMessage(message: unknown, transfer: Transferable[]) {
    if (this.postMessageError) throw this.postMessageError;
    this.messages.push(message);
    this.transfers.push(transfer);
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(data: unknown) {
    this.messageListener?.({ data } as MessageEvent);
  }

  emitError(message: string) {
    this.errorListener?.({ message } as ErrorEvent);
  }
}

class FakeFileReader extends EventTarget {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  readFile?: Blob;
  aborted = false;

  readAsArrayBuffer(file: Blob) {
    this.readFile = file;
  }

  abort() {
    this.aborted = true;
    this.dispatchEvent(new Event("abort"));
  }

  emitLoad(result: ArrayBuffer) {
    this.result = result;
    this.dispatchEvent(new Event("load"));
  }

  emitError(error: DOMException) {
    this.error = error;
    this.dispatchEvent(new Event("error"));
  }
}

const prepared = {
  v: 1,
  pals: [{ i: "pal-1", s: "Anubis" }],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("Palworld save file reading", () => {
  it("aborts an in-progress FileReader when the user cancels", async () => {
    const reader = new FakeFileReader();
    const controller = new AbortController();
    const result = readPalworldSaveFileAsArrayBuffer({
      file: new Blob(["save"]),
      signal: controller.signal,
      createFileReader: () => reader as unknown as FileReader,
    });

    controller.abort();

    await expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      code: "save_parser_aborted",
    });
    expect(reader.aborted).toBe(true);
  });

  it("codes NotReadableError as a stable file read failure", async () => {
    const reader = new FakeFileReader();
    const result = readPalworldSaveFileAsArrayBuffer({
      file: new Blob(["save"]),
      createFileReader: () => reader as unknown as FileReader,
    });

    reader.emitError(
      new DOMException(
        "The requested file could not be read",
        "NotReadableError",
      ),
    );

    await expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      code: "save_file_read_failed",
    });
  });

  it("applies one timeout budget across file reading and worker parsing", async () => {
    vi.useFakeTimers();
    const reader = new FakeFileReader();
    const worker = new FakeSaveParserWorker();
    const result = parsePalworldSaveFileInWorker({
      file: new Blob(["save"]),
      createFileReader: () => reader as unknown as FileReader,
      createWorker: () => worker,
      timeoutMs: 100,
    });
    const assertion = expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      code: "save_parser_timeout",
    });

    await vi.advanceTimersByTimeAsync(40);
    reader.emitLoad(new ArrayBuffer(4));
    await vi.advanceTimersByTimeAsync(60);

    await assertion;
    expect(worker.terminated).toBe(true);
  });
});

describe("parsePalworldSaveInWorker", () => {
  it("transfers the save buffer and terminates after success", async () => {
    const worker = new FakeSaveParserWorker();
    const saveBuffer = new ArrayBuffer(32);
    const result = parsePalworldSaveInWorker({
      saveBuffer,
      createWorker: () => worker,
    });

    expect(worker.messages).toEqual([{ saveBuffer }]);
    expect(worker.transfers).toEqual([[saveBuffer]]);

    worker.emitMessage({ ok: true, prepared });

    await expect(result).resolves.toBe(prepared);
    expect(worker.terminated).toBe(true);
  });

  it("terminates and preserves only a serialized parser error code", async () => {
    const worker = new FakeSaveParserWorker();
    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(32),
      createWorker: () => worker,
    });

    worker.emitMessage({
      ok: false,
      error: { code: "save_limit_exceeded" },
    });

    await expect(result).rejects.toMatchObject({
      name: "Error",
      message: "The save parser failed.",
      code: "save_limit_exceeded",
    });
    expect(worker.terminated).toBe(true);
  });

  it("terminates without propagating private serialized error details", async () => {
    const worker = new FakeSaveParserWorker();
    const privateMessage = `Private save contents: ${"secret".repeat(1_000)}`;
    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(32),
      createWorker: () => worker,
    });

    worker.emitMessage({
      ok: false,
      error: {
        code: "save_limit_exceeded",
        name: "PrivateParserError",
        message: privateMessage,
      },
    });

    const rejection = await result.catch((error: unknown) => error);
    expect(rejection).toMatchObject({
      name: "PalworldSaveParserWorkerError",
      message: "The save parser worker returned an invalid response.",
      code: "save_parser_worker_failed",
    });
    expect((rejection as Error).message).not.toContain("Private save contents");
    expect((rejection as Error).message).not.toContain("secret");
    expect(worker.terminated).toBe(true);
  });

  it("terminates when the worker reports an execution error", async () => {
    const worker = new FakeSaveParserWorker();
    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(32),
      createWorker: () => worker,
    });

    worker.emitError("Private save contents: worker crashed");

    await expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      message: "The save parser worker failed.",
      code: "save_parser_worker_failed",
    });
    expect(worker.terminated).toBe(true);
  });

  it("terminates and rejects malformed worker responses", async () => {
    const worker = new FakeSaveParserWorker();
    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(32),
      createWorker: () => worker,
    });

    worker.emitMessage(null);

    await expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      code: "save_parser_worker_failed",
    });
    expect(worker.terminated).toBe(true);
  });

  it.each([
    { ok: true, prepared, debug: "private" },
    { ok: true, prepared: { ...prepared, debug: "private" } },
  ])(
    "terminates and rejects success responses with extra keys",
    async (response) => {
      const worker = new FakeSaveParserWorker();
      const result = parsePalworldSaveInWorker({
        saveBuffer: new ArrayBuffer(32),
        createWorker: () => worker,
      });

      worker.emitMessage(response);

      await expect(result).rejects.toMatchObject({
        name: "PalworldSaveParserWorkerError",
        code: "save_parser_worker_failed",
      });
      expect(worker.terminated).toBe(true);
    },
  );

  it.each(["", "Save-Limit-Exceeded", "a".repeat(65)])(
    "terminates and rejects an invalid serialized error code",
    async (code) => {
      const worker = new FakeSaveParserWorker();
      const result = parsePalworldSaveInWorker({
        saveBuffer: new ArrayBuffer(32),
        createWorker: () => worker,
      });

      worker.emitMessage({ ok: false, error: { code } });

      await expect(result).rejects.toMatchObject({
        name: "PalworldSaveParserWorkerError",
        code: "save_parser_worker_failed",
      });
      expect(worker.terminated).toBe(true);
    },
  );

  it("terminates when transferring the save buffer fails", async () => {
    const worker = new FakeSaveParserWorker();
    worker.postMessageError = new Error("transfer failed");

    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(32),
      createWorker: () => worker,
    });

    await expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      code: "save_parser_worker_failed",
    });
    expect(worker.terminated).toBe(true);
  });

  it("terminates and rejects when parsing exceeds the time limit", async () => {
    vi.useFakeTimers();
    const worker = new FakeSaveParserWorker();
    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(32),
      createWorker: () => worker,
    });
    const assertion = expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      code: "save_parser_timeout",
    });

    await vi.advanceTimersByTimeAsync(PALWORLD_SAVE_PARSE_TIMEOUT_MS);

    await assertion;
    expect(worker.terminated).toBe(true);
  });

  it("terminates and rejects when parsing is cancelled", async () => {
    const worker = new FakeSaveParserWorker();
    const controller = new AbortController();
    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(32),
      createWorker: () => worker,
      signal: controller.signal,
    });

    controller.abort();

    await expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      code: "save_parser_aborted",
    });
    expect(worker.terminated).toBe(true);

    worker.emitMessage({ ok: true, prepared });
    await expect(result).rejects.toMatchObject({
      code: "save_parser_aborted",
    });
  });

  it("rejects oversized buffers before creating a worker", async () => {
    const createWorker = vi.fn(() => new FakeSaveParserWorker());
    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(PALWORLD_SAV_MAX_FILE_BYTES + 1),
      createWorker,
    });

    await expect(result).rejects.toMatchObject({
      code: "save_limit_exceeded",
    });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("does not create a worker when parsing was already cancelled", async () => {
    const controller = new AbortController();
    const createWorker = vi.fn(() => new FakeSaveParserWorker());
    controller.abort();

    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(32),
      createWorker,
      signal: controller.signal,
    });

    await expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      code: "save_parser_aborted",
    });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("rejects when an isolated worker cannot be created", async () => {
    const result = parsePalworldSaveInWorker({
      saveBuffer: new ArrayBuffer(32),
      createWorker: () => {
        throw new Error("unsupported");
      },
    });

    await expect(result).rejects.toMatchObject({
      name: "PalworldSaveParserWorkerError",
      code: "save_parser_worker_unavailable",
    });
  });
});
