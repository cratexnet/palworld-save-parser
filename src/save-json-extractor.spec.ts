import { describe, expect, it } from "vitest";
import { extractPalworldOwnedPalsFromLevelSaveJson } from "./save-json-extractor";

describe("palworld save JSON inventory extractor", () => {
  it("uses the built-in RawData decoder when no custom decoder is provided", () => {
    const levelSaveJson = {
      properties: {
        worldSaveData: {
          value: {
            CharacterSaveParameterMap: {
              value: [
                {
                  key: {
                    InstanceId: {
                      type: "Guid",
                      value: "instance-owned",
                    },
                  },
                  value: {
                    RawData: {
                      value: {
                        values: Array.from(
                          buildRawCharacterSaveParameter({
                            characterId: "Alpaca",
                            ownerPlayerUidWords: [0, 0, 0, 1],
                            passiveIds: ["Legend"],
                            slotIndex: 177,
                          }),
                        ),
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

    const rows = extractPalworldOwnedPalsFromLevelSaveJson(levelSaveJson);

    expect(rows).toEqual([
      {
        instanceId: "instance-owned",
        characterId: "Alpaca",
        passiveIds: ["Legend"],
        slotIndex: 177,
      },
    ]);
  });

  it("extracts owned non-player pals from CharacterSaveParameterMap raw data entries", () => {
    const levelSaveJson = {
      properties: {
        worldSaveData: {
          value: {
            CharacterSaveParameterMap: {
              value: [
                {
                  key: {
                    InstanceId: {
                      type: "Guid",
                      value: "instance-owned",
                    },
                    PlayerUId: {
                      type: "Guid",
                      value: "00000000-0000-0000-0000-000000000001",
                    },
                  },
                  value: {
                    RawData: {
                      value: {
                        values: [1, 2, 3],
                      },
                    },
                  },
                },
                {
                  key: {
                    InstanceId: {
                      type: "Guid",
                      value: "instance-other-owner",
                    },
                  },
                  value: {
                    RawData: {
                      value: {
                        values: [4, 5, 6],
                      },
                    },
                  },
                },
                {
                  key: {
                    InstanceId: {
                      type: "Guid",
                      value: "instance-player",
                    },
                  },
                  value: {
                    RawData: {
                      value: {
                        values: [7, 8, 9],
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
      decodeRawCharacter: (rawValues) => {
        if (rawValues[0] === 1) {
          return {
            SaveParameter: {
              value: {
                CharacterID: {
                  type: "NameProperty",
                  value: "BlueDragon",
                },
                OwnerPlayerUId: {
                  type: "Guid",
                  value: "00000000-0000-0000-0000-000000000001",
                },
                Gender: {
                  type: "EnumProperty",
                  value: "EPalGenderType::Male",
                },
                PassiveSkillList: {
                  values: [
                    {
                      type: "NameProperty",
                      value: "Legend",
                    },
                    {
                      type: "NameProperty",
                      value: "Stamina_Up_3",
                    },
                  ],
                },
                SlotId: {
                  value: {
                    ContainerId: {
                      value: {
                        ID: {
                          type: "Guid",
                          value: "pal-storage-guid",
                        },
                      },
                    },
                    SlotIndex: {
                      type: "IntProperty",
                      value: 7,
                    },
                  },
                },
              },
            },
          };
        }
        if (rawValues[0] === 4) {
          return {
            SaveParameter: {
              value: {
                CharacterID: "GuardianDog",
                OwnerPlayerUId: "00000000-0000-0000-0000-000000000099",
              },
            },
          };
        }
        return {
          SaveParameter: {
            value: {
              CharacterID: "Player",
              OwnerPlayerUId: "00000000-0000-0000-0000-000000000001",
              IsPlayer: true,
            },
          },
        };
      },
    });

    expect(rows).toEqual([
      {
        instanceId: "instance-owned",
        characterId: "BlueDragon",
        gender: "EPalGenderType::Male",
        passiveIds: ["Legend", "Stamina_Up_3"],
        containerId: "pal-storage-guid",
        slotIndex: 7,
      },
    ]);
  });

  it("includes player-linked base workers and excludes slots owned by other players", () => {
    const levelSaveJson = {
      properties: {
        worldSaveData: {
          value: {
            CharacterSaveParameterMap: {
              value: [
                characterEntry("00000004-0000-0000-0000-000000000005", 1),
                characterEntry("00000006-0000-0000-0000-000000000007", 2),
              ],
            },
            CharacterContainerSaveData: {
              value: [
                {
                  key: { ID: { value: "base-container" } },
                  value: {
                    SlotNum: { value: 15 },
                    Slots: {
                      value: {
                        values: [
                          containerSlot({
                            slotIndex: 4,
                            playerUidWords: [0, 0, 0, 1],
                            instanceIdWords: [4, 0, 0, 5],
                          }),
                          containerSlot({
                            slotIndex: 5,
                            playerUidWords: [0, 0, 0, 99],
                            instanceIdWords: [6, 0, 0, 7],
                          }),
                        ],
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
      decodeRawCharacter: (rawValues) => ({
        SaveParameter: {
          value: {
            CharacterID: rawValues[0] === 1 ? "Anubis" : "GuardianDog",
            OwnerPlayerUId: "00000000-0000-0000-0000-000000000000",
            PassiveSkillList: [],
            SlotId: { value: { SlotIndex: { value: rawValues[0] + 3 } } },
          },
        },
      }),
    });

    expect(rows).toEqual([
      {
        instanceId: "00000004-0000-0000-0000-000000000005",
        characterId: "Anubis",
        passiveIds: [],
        containerType: "base",
        slotIndex: 4,
      },
    ]);
  });
});

function characterEntry(instanceId: string, marker: number) {
  return {
    key: { InstanceId: { value: instanceId } },
    value: { RawData: { value: { values: [marker] } } },
  };
}

function containerSlot(input: {
  slotIndex: number;
  playerUidWords: readonly [number, number, number, number];
  instanceIdWords: readonly [number, number, number, number];
}) {
  return {
    SlotIndex: { value: input.slotIndex },
    RawData: {
      value: {
        values: [
          ...guidFromUint32Words(input.playerUidWords),
          ...guidFromUint32Words(input.instanceIdWords),
          0,
        ],
      },
    },
  };
}

interface RawCharacterFixtureOptions {
  characterId: string;
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

function structProperty(name: string, structType: string, value: number[]) {
  return property(
    name,
    "StructProperty",
    value,
    fstring(structType),
    guidFromUint32Words([0, 0, 0, 0]),
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
