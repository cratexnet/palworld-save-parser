import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import {
  decompressPalworldSavPayload,
  PalworldSavDecompressionError,
} from "./save-decompression";

function wrappedSav(input: {
  magic: "PlM" | "PlZ";
  saveType?: number;
  compressed: Uint8Array;
  uncompressedBytes: number;
}) {
  const body = new Uint8Array(12 + input.compressed.byteLength);
  const view = new DataView(body.buffer);
  view.setUint32(0, input.uncompressedBytes, true);
  view.setUint32(4, input.compressed.byteLength, true);
  body.set(new TextEncoder().encode(input.magic), 8);
  body[11] = input.saveType ?? 0x31;
  body.set(input.compressed, 12);
  return body;
}

function cnkWrappedSav(input: {
  compressed: Uint8Array;
  uncompressedBytes: number;
}) {
  const body = new Uint8Array(24 + input.compressed.byteLength);
  const view = new DataView(body.buffer);
  body.set(new TextEncoder().encode("CNK"), 8);
  view.setUint32(12, input.uncompressedBytes, true);
  view.setUint32(16, input.compressed.byteLength, true);
  body.set(new TextEncoder().encode("CNK"), 20);
  body[23] = 0x30;
  body.set(input.compressed, 24);
  return body;
}

describe("palworld save decompression", () => {
  it("decompresses PlZ zlib payloads from the save wrapper", () => {
    const payload = new TextEncoder().encode("GVAS payload");
    const compressed = zlibSync(payload);

    expect(
      decompressPalworldSavPayload(
        wrappedSav({
          magic: "PlZ",
          compressed,
          uncompressedBytes: payload.byteLength,
        }),
      ),
    ).toEqual({
      header: {
        magic: "PlZ",
        saveType: 0x31,
        compression: "zlib",
        compressedBytes: compressed.byteLength,
        uncompressedBytes: payload.byteLength,
        dataOffset: 12,
      },
      payload,
    });
  });

  it("stops zlib output that exceeds the declared size", () => {
    const payload = new Uint8Array(64 * 1024).fill(0x61);
    const compressed = zlibSync(payload);

    let caught: unknown;
    try {
      decompressPalworldSavPayload(
        wrappedSav({
          magic: "PlZ",
          compressed,
          uncompressedBytes: 1024,
        }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PalworldSavDecompressionError);
    expect(caught).toMatchObject({ code: "save_limit_exceeded" });
    expect((caught as Error).message).toContain(
      "exceeds its declared 1024-byte size",
    );
  });

  it("decompresses shifted CNK zlib payloads", () => {
    const payload = new TextEncoder().encode("legacy CNK payload");
    const compressed = zlibSync(payload);

    const result = decompressPalworldSavPayload(
      cnkWrappedSav({
        compressed,
        uncompressedBytes: payload.byteLength,
      }),
    );

    expect(result.header).toMatchObject({
      magic: "CNK",
      compression: "zlib",
      dataOffset: 24,
    });
    expect(result.payload).toEqual(payload);
  });

  it("requires an explicit decoder for PlM Oodle payloads", () => {
    const compressed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    expect(() =>
      decompressPalworldSavPayload(
        wrappedSav({
          magic: "PlM",
          compressed,
          uncompressedBytes: 4,
        }),
      ),
    ).toThrow(PalworldSavDecompressionError);

    const decoded = new Uint8Array([4, 5, 6, 7]);
    const result = decompressPalworldSavPayload(
      wrappedSav({
        magic: "PlM",
        compressed,
        uncompressedBytes: decoded.byteLength,
      }),
      {
        oodleDecoder: () => decoded,
      },
    );

    expect(result.payload).toBe(decoded);
    expect(result.payload).toEqual(new Uint8Array([4, 5, 6, 7]));
  });

  it("rejects truncated or size-mismatched save payloads", () => {
    const payload = new TextEncoder().encode("GVAS payload");
    const compressed = zlibSync(payload);

    expect(() =>
      decompressPalworldSavPayload(
        wrappedSav({
          magic: "PlZ",
          compressed: compressed.subarray(0, compressed.byteLength - 1),
          uncompressedBytes: payload.byteLength,
        }),
      ),
    ).toThrow(PalworldSavDecompressionError);

    expect(() =>
      decompressPalworldSavPayload(
        wrappedSav({
          magic: "PlZ",
          compressed,
          uncompressedBytes: payload.byteLength + 1,
        }),
      ),
    ).toThrow(PalworldSavDecompressionError);
  });
});
