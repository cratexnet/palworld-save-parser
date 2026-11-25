export type OozDecompressionErrorCode = "decode_failed" | "size_mismatch";

export class OozDecompressionError extends Error {
  constructor(message: string, code: OozDecompressionErrorCode);
  readonly code: OozDecompressionErrorCode;
}

// Decompress data
// NOTE: returned TypedArray lives in WASM memory, you can safely use it
//       until the next call to decompressUnsafe/decompress.
export function decompressUnsafe(data: Uint8Array, rawSize: number): Uint8Array;

// Decompress data into a standalone copy.
export function decompress(data: Uint8Array, rawSize: number): Uint8Array;
