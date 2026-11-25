import { describe, expect, it } from "vitest";
import { extractPalworldOwnedPalsFromLevelSaveJson } from "./save-json-extractor";
import {
  decodePalworldRawCharacterSaveParameter,
  PalworldRawCharacterDecodeError,
} from "./save-raw-character-decoder";
import {
  PALWORLD_MAX_FSTRING_ENCODED_BYTES,
  PALWORLD_MAX_RAW_CHARACTER_ARRAY_ITEMS,
  PALWORLD_MAX_RAW_CHARACTER_BYTES,
  PALWORLD_MAX_RAW_CHARACTER_PROPERTIES,
  PALWORLD_MAX_RAW_CHARACTER_RECURSION_DEPTH,
} from "./save-parser-limits";

describe("palworld raw character decoder", () => {
  it("decodes SaveParameter fields needed for owned Pal inventory extraction", () => {
    const rawValues = buildRawCharacterSaveParameter({
      characterId: "Alpaca",
      gender: "EPalGenderType::Female",
      ownerPlayerUidWords: [0, 0, 0, 1],
      passiveIds: ["Legend", "Deffence_down2"],
      slotIndex: 177,
    });

    const decoded = decodePalworldRawCharacterSaveParameter(rawValues);

    expect(decoded).toMatchObject({
      SaveParameter: {
        type: "StructProperty",
        value: {
          CharacterID: {
            type: "NameProperty",
            value: "Alpaca",
          },
          Gender: {
            type: "EnumProperty",
            value: "EPalGenderType::Female",
          },
          OwnerPlayerUId: {
            type: "StructProperty",
            value: "00000000-0000-0000-0000-000000000001",
          },
          SlotId: {
            type: "StructProperty",
            value: {
              SlotIndex: {
                type: "IntProperty",
                value: 177,
              },
            },
          },
        },
      },
    });
  });

  it("skips Set and Map metadata before target SaveParameter fields", () => {
    const rawValues = bytes(
      propertyList(
        structProperty(
          "SaveParameter",
          "PalIndividualCharacterSaveParameter",
          propertyList(
            setProperty("UnknownSet", "StructProperty", int32(0)),
            mapProperty(
              "UnknownMap",
              "NameProperty",
              "IntProperty",
              int32(0),
              int32(0),
            ),
            nameProperty("CharacterID", "SheepBall"),
            enumProperty("Gender", "EPalGenderType", "EPalGenderType::Male"),
            structProperty(
              "SlotId",
              "PalCharacterSlotId",
              propertyList(intProperty("SlotIndex", 3)),
            ),
          ),
        ),
      ),
    );

    const decoded = decodePalworldRawCharacterSaveParameter(rawValues);

    expect(decoded).toMatchObject({
      SaveParameter: {
        value: {
          CharacterID: {
            value: "SheepBall",
          },
          Gender: {
            value: "EPalGenderType::Male",
          },
          SlotId: {
            value: {
              SlotIndex: {
                value: 3,
              },
            },
          },
        },
      },
    });
  });

  it("rejects nested property values beyond their containing struct", () => {
    const rawValues = bytes([
      ...propertyList(
        structProperty(
          "SaveParameter",
          "PalIndividualCharacterSaveParameter",
          propertyList(
            propertyWithDeclaredSize("UnknownInt", "IntProperty", 64, int32(1)),
          ),
        ),
      ),
      ...new Array(64).fill(0),
    ]);

    expect(() => decodePalworldRawCharacterSaveParameter(rawValues)).toThrow(
      "exceeds its containing property",
    );
  });

  it("feeds decoded RawData into the Level.sav JSON extractor", () => {
    const rawValues = buildRawCharacterSaveParameter({
      characterId: "Alpaca",
      gender: "EPalGenderType::Female",
      ownerPlayerUidWords: [0, 0, 0, 1],
      passiveIds: ["Legend", "Deffence_down2"],
      slotIndex: 177,
    });
    const levelSaveJson = {
      properties: {
        worldSaveData: {
          value: {
            CharacterSaveParameterMap: {
              value: [
                {
                  key: {
                    InstanceId: {
                      type: "StructProperty",
                      value: "9297a2b4-48e2-e000-6973-bfbe8332e4ef",
                    },
                  },
                  value: {
                    RawData: {
                      value: {
                        values: Array.from(rawValues),
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    };

    const rows = extractPalworldOwnedPalsFromLevelSaveJson(levelSaveJson, {
      decodeRawCharacter: decodePalworldRawCharacterSaveParameter,
    });

    expect(rows).toEqual([
      {
        instanceId: "9297a2b4-48e2-e000-6973-bfbe8332e4ef",
        characterId: "Alpaca",
        gender: "EPalGenderType::Female",
        passiveIds: ["Legend", "Deffence_down2"],
        slotIndex: 177,
      },
    ]);
  });

  it("decodes UTF-16 FStrings without a code-unit string loop", () => {
    const rawValues = bytes(
      propertyList(
        property("LocalizedName", "StrProperty", utf16Fstring("Pal World")),
      ),
    );

    expect(decodePalworldRawCharacterSaveParameter(rawValues)).toMatchObject({
      LocalizedName: { value: "Pal World" },
    });
  });

  it("allows RawData at the byte limit and rejects larger input first", () => {
    const rawAtLimit = new Uint8Array(PALWORLD_MAX_RAW_CHARACTER_BYTES);
    rawAtLimit.set(fstring("None"));

    expect(decodePalworldRawCharacterSaveParameter(rawAtLimit)).toEqual({});
    expectRawLimit(
      () =>
        decodePalworldRawCharacterSaveParameter(
          new Uint8Array(PALWORLD_MAX_RAW_CHARACTER_BYTES + 1),
        ),
      "RawData exceeds",
    );
  });

  it("rejects oversized FStrings before reading or decoding their bytes", () => {
    expectRawLimit(
      () =>
        decodePalworldRawCharacterSaveParameter(
          bytes(int32(PALWORLD_MAX_FSTRING_ENCODED_BYTES + 1)),
        ),
      "FString exceeds",
    );
  });

  it("bounds recognized array item allocations", () => {
    const rawValues = bytes(
      propertyList(
        arrayProperty(
          "TooManyNames",
          "NameProperty",
          int32(PALWORLD_MAX_RAW_CHARACTER_ARRAY_ITEMS + 1),
        ),
      ),
    );

    expectRawLimit(
      () => decodePalworldRawCharacterSaveParameter(rawValues),
      "recognized array item limit",
    );
  });

  it("bounds property object allocations across nested lists", () => {
    const properties = Array.from(
      { length: PALWORLD_MAX_RAW_CHARACTER_PROPERTIES + 1 },
      (_, index) => intProperty(`Property${index}`, index),
    );

    expectRawLimit(
      () =>
        decodePalworldRawCharacterSaveParameter(
          bytes(propertyList(...properties)),
        ),
      "property limit",
    );
  });

  it("bounds recursive struct-property descent", () => {
    let nested = propertyList();
    for (
      let depth = 0;
      depth < PALWORLD_MAX_RAW_CHARACTER_RECURSION_DEPTH + 1;
      depth += 1
    ) {
      nested = propertyList(
        structProperty(`Nested${depth}`, "PalContainerId", nested),
      );
    }

    expectRawLimit(
      () => decodePalworldRawCharacterSaveParameter(bytes(nested)),
      "recursion depth",
    );
  });
});

function expectRawLimit(action: () => unknown, message: string) {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(PalworldRawCharacterDecodeError);
  expect(caught).toMatchObject({ code: "invalid_raw_character_data" });
  expect((caught as Error).message).toContain(message);
}

interface RawCharacterFixtureOptions {
  characterId: string;
  gender: string;
  ownerPlayerUidWords: readonly [number, number, number, number];
  passiveIds: readonly string[];
  slotIndex: number;
}

function buildRawCharacterSaveParameter(options: RawCharacterFixtureOptions) {
  return bytes(
    propertyList(
      structProperty(
        "SaveParameter",
        "PalIndividualCharacterSaveParameter",
        propertyList(
          nameProperty("CharacterID", options.characterId),
          enumProperty("Gender", "EPalGenderType", options.gender),
          structProperty(
            "OwnerPlayerUId",
            "Guid",
            guidFromUint32Words(options.ownerPlayerUidWords),
          ),
          arrayProperty(
            "PassiveSkillList",
            "NameProperty",
            int32(options.passiveIds.length),
            ...options.passiveIds.map(fstring),
          ),
          structProperty(
            "SlotId",
            "PalCharacterSlotId",
            propertyList(intProperty("SlotIndex", options.slotIndex)),
          ),
        ),
      ),
    ),
  );
}

function propertyList(...properties: number[][]) {
  return [...properties.flat(), ...fstring("None")];
}

function nameProperty(name: string, value: string) {
  return property(name, "NameProperty", fstring(value));
}

function enumProperty(name: string, enumType: string, value: string) {
  return property(name, "EnumProperty", fstring(value), fstring(enumType));
}

function intProperty(name: string, value: number) {
  return property(name, "IntProperty", int32(value));
}

function arrayProperty(
  name: string,
  innerType: string,
  ...valueParts: number[][]
) {
  return property(name, "ArrayProperty", valueParts.flat(), fstring(innerType));
}

function mapProperty(
  name: string,
  keyType: string,
  valueType: string,
  ...valueParts: number[][]
) {
  return property(
    name,
    "MapProperty",
    valueParts.flat(),
    fstring(keyType),
    fstring(valueType),
  );
}

function setProperty(name: string, innerType: string, value: number[]) {
  return property(name, "SetProperty", value, fstring(innerType));
}

function structProperty(name: string, structType: string, value: number[]) {
  return property(
    name,
    "StructProperty",
    value,
    fstring(structType),
    guidFromUint32Words([0, 0, 0, 0]),
  );
}

function propertyWithDeclaredSize(
  name: string,
  type: string,
  size: number,
  value: number[],
  ...metadata: number[][]
) {
  return [
    ...fstring(name),
    ...fstring(type),
    ...int64(size),
    ...metadata.flat(),
    0,
    ...value,
  ];
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
    ...int64(value.length),
    ...metadata.flat(),
    0,
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

function utf16Fstring(value: string) {
  const encoded: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    encoded.push(codeUnit & 0xff, codeUnit >> 8);
  }
  return [...int32(-(value.length + 1)), ...encoded, 0, 0];
}

function int32(value: number) {
  return [value, value >> 8, value >> 16, value >> 24].map(
    (byte) => byte & 0xff,
  );
}

function int64(value: number) {
  return [...int32(value), 0, 0, 0, 0];
}

function bytes(values: number[]) {
  return Uint8Array.from(values);
}
