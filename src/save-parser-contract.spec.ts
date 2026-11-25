import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import { inspectPalworldLocalSave } from "./save-parser-contract";

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

describe("palworld local save parser contract", () => {
  it("reports Oodle as the current blocker for modern PlM saves", () => {
    const compressed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const uncompressedBytes = 1024;

    expect(
      inspectPalworldLocalSave(
        wrappedSav({
          uncompressedBytes,
          compressed,
          magic: "PlM",
          saveType: 0x31,
        }),
      ),
    ).toEqual({
      status: "blocked",
      blocker: "unsupported_oodle_decoder",
      header: {
        magic: "PlM",
        saveType: 0x31,
        compression: "oodle",
        compressedBytes: compressed.byteLength,
        uncompressedBytes,
        dataOffset: 12,
      },
    });
  });

  it("parses GVAS inventory rows after an Oodle decoder succeeds", () => {
    const compressed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const payload = emptyGvasPayload();

    expect(
      inspectPalworldLocalSave(
        wrappedSav({
          uncompressedBytes: payload.byteLength,
          compressed,
          magic: "PlM",
          saveType: 0x31,
        }),
        {
          oodleDecoder: () => payload,
        },
      ),
    ).toMatchObject({
      status: "parsed",
      rows: [],
      header: {
        magic: "PlM",
        compression: "oodle",
        dataOffset: 12,
      },
    });
  });

  it("parses zlib-wrapper saves with the built-in GVAS extractor", () => {
    const payload = emptyGvasPayload();
    const compressed = zlibSync(payload);

    expect(
      inspectPalworldLocalSave(
        cnkWrappedSav({
          compressed,
          uncompressedBytes: payload.byteLength,
        }),
      ),
    ).toMatchObject({
      status: "parsed",
      rows: [],
      header: {
        magic: "CNK",
        compression: "zlib",
        dataOffset: 24,
      },
    });

    expect(
      inspectPalworldLocalSave(
        wrappedSav({
          uncompressedBytes: payload.byteLength,
          compressed,
          magic: "PlZ",
          saveType: 0x32,
        }),
      ),
    ).toMatchObject({
      status: "parsed",
      rows: [],
      header: {
        magic: "PlZ",
        compression: "zlib",
        dataOffset: 12,
      },
    });
  });

  it("returns extracted inventory rows after decompression when a GVAS extractor is available", () => {
    const payload = new TextEncoder().encode("GVAS payload");
    const compressed = zlibSync(payload);

    expect(
      inspectPalworldLocalSave(
        wrappedSav({
          uncompressedBytes: payload.byteLength,
          compressed,
          magic: "PlZ",
          saveType: 0x32,
        }),
        {
          gvasExtractor: (decompressedPayload) => {
            expect(decompressedPayload).toEqual(payload);
            return [
              {
                instanceId: "map-entry-1",
                characterId: "BlueDragon",
                gender: "EPalGenderType::Male",
                passiveIds: ["Legend", "Stamina_Up_3"],
                slotIndex: 7,
              },
            ];
          },
        },
      ),
    ).toMatchObject({
      status: "parsed",
      rows: [
        {
          instanceId: "map-entry-1",
          characterId: "BlueDragon",
          gender: "EPalGenderType::Male",
          passiveIds: ["Legend", "Stamina_Up_3"],
          slotIndex: 7,
        },
      ],
      header: {
        magic: "PlZ",
        compression: "zlib",
        dataOffset: 12,
      },
    });
  });
});

function emptyGvasPayload() {
  return bytes([
    ...ascii("GVAS"),
    ...int32(3),
    ...int32(522),
    ...int32(1008),
    ...uint16(5),
    ...uint16(1),
    ...uint16(1),
    ...uint32(0),
    ...fstring("++UE5+Release-5.1"),
    ...int32(3),
    ...uint32(0),
    ...fstring("PalWorldBaseInfoSaveGame"),
    ...propertyList(
      structProperty(
        "worldSaveData",
        "PalWorldSaveData",
        propertyList(
          property(
            "CharacterSaveParameterMap",
            "MapProperty",
            [...int32(0), ...int32(0)],
            fstring("StructProperty"),
            fstring("StructProperty"),
            [0],
          ),
        ),
      ),
    ),
    ...int32(0),
  ]);
}

function propertyList(...properties: number[][]) {
  return [...properties.flat(), ...fstring("None")];
}

function structProperty(name: string, structType: string, value: number[]) {
  return property(
    name,
    "StructProperty",
    value,
    fstring(structType),
    guidFromUint32Words([0, 0, 0, 0]),
    [0],
  );
}

function property(
  name: string,
  type: string,
  value: number[],
  ...metadata: number[][]
) {
  return [
    ...fstring(name),
    ...fstring(type),
    ...uint64(value.length),
    ...metadata.flat(),
    ...value,
  ];
}

function guidFromUint32Words(words: readonly [number, number, number, number]) {
  return words.flatMap(int32);
}

function fstring(value: string) {
  const encoded = Array.from(new TextEncoder().encode(value));
  return [...int32(encoded.length + 1), ...encoded, 0];
}

function ascii(value: string) {
  return Array.from(new TextEncoder().encode(value));
}

function int32(value: number) {
  return uint32(value);
}

function uint32(value: number) {
  return [value, value >> 8, value >> 16, value >> 24].map(
    (byte) => byte & 0xff,
  );
}

function uint16(value: number) {
  return [value, value >> 8].map((byte) => byte & 0xff);
}

function uint64(value: number) {
  return [...uint32(value), 0, 0, 0, 0];
}

function bytes(values: number[]) {
  return Uint8Array.from(values);
}
