import { describe, expect, it } from "vitest";
import {
  assertPalworldSaveFileSize,
  PALWORLD_SAV_MAX_COMPRESSED_BYTES,
  PALWORLD_SAV_MAX_EXPANSION_RATIO,
  PALWORLD_SAV_MAX_FILE_BYTES,
  PALWORLD_SAV_MAX_UNCOMPRESSED_BYTES,
  parsePalworldSavHeader,
  PalworldSavHeaderError,
} from "./save-file-header";

function savHeader(input: {
  uncompressedBytes: number;
  compressedBytes: number;
  magic: "PlM" | "PlZ";
  saveType: number;
}) {
  const body = new Uint8Array(12 + input.compressedBytes);
  const view = new DataView(body.buffer);
  view.setUint32(0, input.uncompressedBytes, true);
  view.setUint32(4, input.compressedBytes, true);
  body.set(new TextEncoder().encode(input.magic), 8);
  body[11] = input.saveType;
  return body;
}

function cnkHeader() {
  const body = new Uint8Array(24);
  const view = new DataView(body.buffer);
  body.set(new TextEncoder().encode("CNK"), 8);
  view.setUint32(12, 4096, true);
  view.setUint32(16, 1024, true);
  body.set(new TextEncoder().encode("CNK"), 20);
  body[23] = 0x30;
  return body;
}

function declaredHeader(input: {
  uncompressedBytes: number;
  compressedBytes: number;
}) {
  const body = new Uint8Array(24);
  const view = new DataView(body.buffer);
  view.setUint32(0, input.uncompressedBytes, true);
  view.setUint32(4, input.compressedBytes, true);
  body.set(new TextEncoder().encode("PlM"), 8);
  body[11] = 0x31;
  return body;
}

describe("parsePalworldSavHeader", () => {
  it("parses PlM Oodle save headers", () => {
    expect(
      parsePalworldSavHeader(
        savHeader({
          uncompressedBytes: 30_286_784,
          compressedBytes: 2_264_089,
          magic: "PlM",
          saveType: 0x31,
        }),
      ),
    ).toEqual({
      magic: "PlM",
      saveType: 0x31,
      compression: "oodle",
      compressedBytes: 2_264_089,
      uncompressedBytes: 30_286_784,
      dataOffset: 12,
    });
  });

  it("parses PlZ zlib save headers", () => {
    expect(
      parsePalworldSavHeader(
        savHeader({
          uncompressedBytes: 8192,
          compressedBytes: 2048,
          magic: "PlZ",
          saveType: 0x32,
        }),
      ),
    ).toMatchObject({
      magic: "PlZ",
      saveType: 0x32,
      compression: "zlib",
      dataOffset: 12,
    });
  });

  it("parses CNK headers with the shifted data offset", () => {
    expect(parsePalworldSavHeader(cnkHeader())).toEqual({
      magic: "CNK",
      saveType: 0x30,
      compression: "zlib",
      compressedBytes: 1024,
      uncompressedBytes: 4096,
      dataOffset: 24,
    });
  });

  it("rejects unknown or incomplete save headers", () => {
    expect(() => parsePalworldSavHeader(new Uint8Array(11))).toThrow(
      PalworldSavHeaderError,
    );
    expect(() =>
      parsePalworldSavHeader(
        savHeader({
          uncompressedBytes: 1,
          compressedBytes: 1,
          magic: "PlM",
          saveType: 0xff,
        }),
      ),
    ).toThrow(PalworldSavHeaderError);
  });

  it("rejects save files above the browser processing limit", () => {
    expect(() =>
      assertPalworldSaveFileSize(PALWORLD_SAV_MAX_FILE_BYTES + 1),
    ).toThrow(PalworldSavHeaderError);
  });

  it("rejects declared compressed payloads above the processing limit", () => {
    expect(() =>
      parsePalworldSavHeader(
        declaredHeader({
          uncompressedBytes: PALWORLD_SAV_MAX_COMPRESSED_BYTES + 1,
          compressedBytes: PALWORLD_SAV_MAX_COMPRESSED_BYTES + 1,
        }),
      ),
    ).toThrow(PalworldSavHeaderError);
  });

  it("rejects declared decompressed payloads above the memory limit", () => {
    expect(() =>
      parsePalworldSavHeader(
        declaredHeader({
          uncompressedBytes: PALWORLD_SAV_MAX_UNCOMPRESSED_BYTES + 1,
          compressedBytes: PALWORLD_SAV_MAX_COMPRESSED_BYTES,
        }),
      ),
    ).toThrow(PalworldSavHeaderError);
  });

  it("rejects implausible expansion ratios before loading the decoder", () => {
    expect(() =>
      parsePalworldSavHeader(
        declaredHeader({
          uncompressedBytes: PALWORLD_SAV_MAX_EXPANSION_RATIO + 1,
          compressedBytes: 1,
        }),
      ),
    ).toThrow(PalworldSavHeaderError);
  });
});
