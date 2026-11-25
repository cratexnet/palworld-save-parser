import { describe, expect, it } from "vitest";
import {
  createOozWasmPalworldOodleDecoder,
  loadRequiredOozWasmPalworldOodleDecoder,
  loadOozWasmPalworldOodleDecoder,
  type OozWasmModule,
} from "./ooz-wasm-decoder";
import type { PalworldSavHeader } from "./save-file-header";

const OODLE_HEADER = {
  magic: "PlM",
  saveType: 0x31,
  compression: "oodle",
  compressedBytes: 3,
  uncompressedBytes: 5,
  dataOffset: 12,
} satisfies PalworldSavHeader;

describe("ooz-wasm Palworld Oodle decoder", () => {
  it("uses the WASM-backed view without copying the decompressed payload", () => {
    const calls: { compressed: Uint8Array; rawSize: number }[] = [];
    const decoded = new Uint8Array([9, 8, 7, 6, 5]);
    const oozWasm = {
      decompressUnsafe(compressed, rawSize) {
        calls.push({ compressed, rawSize });
        return decoded;
      },
    } satisfies OozWasmModule;

    const compressed = new Uint8Array([1, 2, 3]);
    const decoder = createOozWasmPalworldOodleDecoder(oozWasm);

    expect(decoder(compressed, OODLE_HEADER)).toBe(decoded);
    expect(calls).toEqual([{ compressed, rawSize: 5 }]);
  });

  it("loads ooz-wasm lazily before creating the decoder", async () => {
    let loaded = false;
    const decoded = new Uint8Array([1, 3, 5, 7, 9]);
    const loadOozWasm = async () => {
      loaded = true;
      return {
        decompressUnsafe: () => decoded,
      } satisfies OozWasmModule;
    };

    const decoder = await loadOozWasmPalworldOodleDecoder(loadOozWasm);

    expect(loaded).toBe(true);
    expect(decoder(new Uint8Array([2, 4]), OODLE_HEADER)).toBe(decoded);
  });

  it.each([
    ["Failed to decode", "decode_failed", "oodle_decode_failed"],
    [
      "Decompresed size is different from expected",
      "size_mismatch",
      "oodle_size_mismatch",
    ],
  ] as const)(
    "maps the vendor error %s by its structured code",
    (message, vendorCode, expectedCode) => {
      const decoder = createOozWasmPalworldOodleDecoder({
        decompressUnsafe() {
          throw Object.assign(new Error(message), {
            name: "OozDecompressionError",
            code: vendorCode,
          });
        },
      });

      let thrown: unknown;
      try {
        decoder(new Uint8Array([1, 2, 3]), OODLE_HEADER);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        name: "PalworldSavDecompressionError",
        code: expectedCode,
      });
    },
  );

  it("reports Oodle decoder load failures with the parser blocker code", async () => {
    await expect(
      loadRequiredOozWasmPalworldOodleDecoder(async () => {
        throw new TypeError("Failed to fetch dynamically imported module");
      }),
    ).rejects.toMatchObject({
      name: "PalworldParserCapabilityError",
      code: "unsupported_oodle_decoder",
    });
  });
});
