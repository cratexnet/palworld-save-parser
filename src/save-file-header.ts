export type PalworldSavMagic = "PlM" | "PlZ" | "CNK";
export type PalworldSavCompression = "oodle" | "zlib";

export interface PalworldSavHeader {
  magic: PalworldSavMagic;
  saveType: number;
  compression: PalworldSavCompression;
  compressedBytes: number;
  uncompressedBytes: number;
  dataOffset: number;
}

export class PalworldSavHeaderError extends Error {
  constructor(
    message: string,
    readonly code = "invalid_save_header",
  ) {
    super(message);
    this.name = "PalworldSavHeaderError";
  }
}

const PALWORLD_SAV_MIN_HEADER_BYTES = 24;
const MEBIBYTE = 1024 * 1024;

export const PALWORLD_SAV_MAX_FILE_BYTES = 128 * MEBIBYTE;
export const PALWORLD_SAV_MAX_COMPRESSED_BYTES = 128 * MEBIBYTE;
export const PALWORLD_SAV_MAX_UNCOMPRESSED_BYTES = 256 * MEBIBYTE;
export const PALWORLD_SAV_MAX_EXPANSION_RATIO = 128;

export function assertPalworldSaveFileSize(fileBytes: number) {
  if (
    !Number.isSafeInteger(fileBytes) ||
    fileBytes < 0 ||
    fileBytes > PALWORLD_SAV_MAX_FILE_BYTES
  ) {
    throw saveLimitError(
      `Palworld save exceeds the ${PALWORLD_SAV_MAX_FILE_BYTES}-byte browser processing limit.`,
    );
  }
}

export function parsePalworldSavHeader(data: Uint8Array): PalworldSavHeader {
  if (data.byteLength < PALWORLD_SAV_MIN_HEADER_BYTES) {
    throw new PalworldSavHeaderError("Palworld save header is incomplete.");
  }

  const firstMagic = readAscii(data, 8, 11);
  const headerOffset = firstMagic === "CNK" ? 12 : 0;
  const dataOffset = firstMagic === "CNK" ? 24 : 12;
  const magic = readAscii(data, headerOffset + 8, headerOffset + 11);
  const saveType = data[headerOffset + 11];

  if (!isPalworldSavMagic(magic)) {
    throw new PalworldSavHeaderError(`Unknown Palworld save magic: ${magic}.`);
  }
  if (!isPalworldSavType(saveType)) {
    throw new PalworldSavHeaderError(
      `Unknown Palworld save type: 0x${saveType.toString(16)}.`,
    );
  }

  const header: PalworldSavHeader = {
    magic,
    saveType,
    compression: magic === "PlM" ? "oodle" : "zlib",
    uncompressedBytes: readUint32LE(data, headerOffset),
    compressedBytes: readUint32LE(data, headerOffset + 4),
    dataOffset,
  };

  assertPalworldSavHeaderLimits(header);
  return header;
}

function assertPalworldSavHeaderLimits(header: PalworldSavHeader) {
  if (
    header.compressedBytes === 0 ||
    header.compressedBytes > PALWORLD_SAV_MAX_COMPRESSED_BYTES
  ) {
    throw saveLimitError(
      `Palworld save declares an unsupported compressed size of ${header.compressedBytes} bytes.`,
    );
  }
  if (
    header.uncompressedBytes === 0 ||
    header.uncompressedBytes > PALWORLD_SAV_MAX_UNCOMPRESSED_BYTES
  ) {
    throw saveLimitError(
      `Palworld save declares an unsupported decompressed size of ${header.uncompressedBytes} bytes.`,
    );
  }
  if (
    header.uncompressedBytes / header.compressedBytes >
    PALWORLD_SAV_MAX_EXPANSION_RATIO
  ) {
    throw saveLimitError(
      `Palworld save exceeds the ${PALWORLD_SAV_MAX_EXPANSION_RATIO}:1 expansion ratio limit.`,
    );
  }
}

function saveLimitError(message: string) {
  return new PalworldSavHeaderError(message, "save_limit_exceeded");
}

function isPalworldSavMagic(value: string): value is PalworldSavMagic {
  return value === "PlM" || value === "PlZ" || value === "CNK";
}

function isPalworldSavType(value: number) {
  return value === 0x30 || value === 0x31 || value === 0x32;
}

function readUint32LE(data: Uint8Array, offset: number) {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

function readAscii(data: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...data.subarray(start, end));
}
