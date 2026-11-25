import { Unzlib } from "fflate";
import {
  PALWORLD_SAV_MAX_UNCOMPRESSED_BYTES,
  parsePalworldSavHeader,
  type PalworldSavHeader,
} from "./save-file-header";

export type PalworldSavDecompressionErrorCode =
  | "decompression_failed"
  | "decompressed_size_mismatch"
  | "save_limit_exceeded"
  | "oodle_decode_failed"
  | "oodle_size_mismatch";

export class PalworldSavDecompressionError extends Error {
  constructor(
    message: string,
    readonly code: PalworldSavDecompressionErrorCode = "decompression_failed",
  ) {
    super(message);
    this.name = "PalworldSavDecompressionError";
  }
}

export type PalworldOodleDecoder = (
  compressed: Uint8Array,
  header: PalworldSavHeader,
) => Uint8Array;

export interface PalworldSavDecompressionOptions {
  oodleDecoder?: PalworldOodleDecoder;
}

export interface PalworldSavDecompressionResult {
  header: PalworldSavHeader;
  payload: Uint8Array;
}

export function decompressPalworldSavPayload(
  data: Uint8Array,
  options: PalworldSavDecompressionOptions = {},
): PalworldSavDecompressionResult {
  const header = parsePalworldSavHeader(data);
  const compressed = readCompressedPayload(data, header);
  const payload =
    header.compression === "oodle"
      ? decompressOodlePayload(compressed, header, options)
      : decompressZlibPayload(compressed, header);

  if (payload.byteLength !== header.uncompressedBytes) {
    throw new PalworldSavDecompressionError(
      `Palworld save decompressed to ${payload.byteLength} bytes, expected ${header.uncompressedBytes}.`,
      "decompressed_size_mismatch",
    );
  }

  return {
    header,
    payload,
  };
}

function readCompressedPayload(data: Uint8Array, header: PalworldSavHeader) {
  const endOffset = header.dataOffset + header.compressedBytes;
  if (endOffset > data.byteLength) {
    throw new PalworldSavDecompressionError(
      `Palworld save payload is truncated: expected ${header.compressedBytes} compressed bytes.`,
    );
  }
  return data.subarray(header.dataOffset, endOffset);
}

function decompressOodlePayload(
  compressed: Uint8Array,
  header: PalworldSavHeader,
  options: PalworldSavDecompressionOptions,
) {
  if (!options.oodleDecoder) {
    throw new PalworldSavDecompressionError(
      "Palworld PlM saves require an Oodle decoder.",
    );
  }
  try {
    return options.oodleDecoder(compressed, header);
  } catch (error) {
    if (error instanceof PalworldSavDecompressionError) throw error;
    throw new PalworldSavDecompressionError(
      error instanceof Error
        ? `Could not decompress Palworld Oodle payload: ${error.message}`
        : "Could not decompress Palworld Oodle payload.",
      "oodle_decode_failed",
    );
  }
}

function decompressZlibPayload(
  compressed: Uint8Array,
  header: PalworldSavHeader,
) {
  const payload = new Uint8Array(header.uncompressedBytes);
  let producedBytes = 0;

  try {
    const stream = new Unzlib((chunk) => {
      const nextProducedBytes = producedBytes + chunk.byteLength;
      if (nextProducedBytes > PALWORLD_SAV_MAX_UNCOMPRESSED_BYTES) {
        throw new PalworldSavDecompressionError(
          `Palworld zlib output exceeds the ${PALWORLD_SAV_MAX_UNCOMPRESSED_BYTES}-byte browser processing limit.`,
          "save_limit_exceeded",
        );
      }
      if (nextProducedBytes > header.uncompressedBytes) {
        throw new PalworldSavDecompressionError(
          `Palworld zlib output exceeds its declared ${header.uncompressedBytes}-byte size.`,
          "save_limit_exceeded",
        );
      }

      payload.set(chunk, producedBytes);
      producedBytes = nextProducedBytes;
    });

    const chunkBytes = 1024;
    for (let offset = 0; offset < compressed.byteLength; offset += chunkBytes) {
      const endOffset = Math.min(offset + chunkBytes, compressed.byteLength);
      stream.push(
        compressed.subarray(offset, endOffset),
        endOffset === compressed.byteLength,
      );
    }
  } catch (error) {
    if (error instanceof PalworldSavDecompressionError) throw error;
    throw new PalworldSavDecompressionError(
      error instanceof Error
        ? `Could not decompress Palworld zlib payload: ${error.message}`
        : "Could not decompress Palworld zlib payload.",
    );
  }

  if (producedBytes !== header.uncompressedBytes) {
    throw new PalworldSavDecompressionError(
      `Palworld save decompressed to ${producedBytes} bytes, expected ${header.uncompressedBytes}.`,
      "decompressed_size_mismatch",
    );
  }
  return payload;
}
