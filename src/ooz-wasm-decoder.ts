import { PalworldParserCapabilityError } from "./parser-capability-error";
import {
  PalworldSavDecompressionError,
  type PalworldOodleDecoder,
} from "./save-decompression";

export interface OozWasmModule {
  decompressUnsafe(compressed: Uint8Array, rawSize: number): Uint8Array;
}

export type OozWasmModuleLoader = () => Promise<OozWasmModule>;
export type PalworldOodleDecoderLoader = () => Promise<PalworldOodleDecoder>;

/**
 * The returned decoder exposes the WASM-backed output view. Save parsing must
 * consume it synchronously before invoking this decoder again.
 */
export function createOozWasmPalworldOodleDecoder(
  oozWasm: OozWasmModule,
): PalworldOodleDecoder {
  return (compressed, header) => {
    try {
      return oozWasm.decompressUnsafe(compressed, header.uncompressedBytes);
    } catch (error) {
      if (isOozWasmDecompressionError(error)) {
        throw new PalworldSavDecompressionError(
          `Could not decompress Palworld Oodle payload: ${error.message}`,
          error.code === "size_mismatch"
            ? "oodle_size_mismatch"
            : "oodle_decode_failed",
        );
      }
      throw error;
    }
  };
}

export async function loadOozWasmPalworldOodleDecoder(
  loadOozWasm: OozWasmModuleLoader = () =>
    import("../vendor/palworld-ooz/index.js"),
) {
  return createOozWasmPalworldOodleDecoder(await loadOozWasm());
}

export async function loadRequiredOozWasmPalworldOodleDecoder(
  loadOodleDecoder: PalworldOodleDecoderLoader = () =>
    loadOozWasmPalworldOodleDecoder(),
): Promise<PalworldOodleDecoder> {
  try {
    return await loadOodleDecoder();
  } catch {
    throw new PalworldParserCapabilityError(
      "Palworld Oodle decoder could not be loaded.",
      "unsupported_oodle_decoder",
    );
  }
}

function isOozWasmDecompressionError(
  error: unknown,
): error is Error & { code: "decode_failed" | "size_mismatch" } {
  return (
    error instanceof Error &&
    error.name === "OozDecompressionError" &&
    "code" in error &&
    (error.code === "decode_failed" || error.code === "size_mismatch")
  );
}
