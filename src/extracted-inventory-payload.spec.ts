import { describe, expect, it } from "vitest";
import { createPalworldSpeciesFixture } from "./fixtures";
import { createCompactOwnedPalsPayloadFromExtractRows } from "./extracted-inventory-payload";

describe("palworld extracted inventory payload builder", () => {
  it("turns parser rows into a compact payload without save instance IDs", () => {
    const fixture = createPalworldSpeciesFixture();

    const result = createCompactOwnedPalsPayloadFromExtractRows({
      gameData: fixture.gameData,
      rows: [
        {
          instanceId: "slot-a",
          characterId: "a",
          gender: "EPalGenderType::Male",
          passiveIds: "Legend;MoveSpeed_up_3",
          containerId: "pal-storage-guid",
          containerType: "palbox",
          slotIndex: 10,
        },
        {
          instanceId: "slot-b",
          characterId: "BOSS_Sheepball",
          gender: "Female",
          passiveIds: ["Stamina_Up_3"],
          slotIndex: "11",
        },
      ],
    });

    expect(result.payload).toEqual({
      v: 1,
      pals: [
        {
          i: "pal-1",
          s: "A",
          g: "M",
          p: ["Legend", "MoveSpeed_up_3"],
          l: "palbox:10",
        },
        {
          i: "pal-2",
          s: "SheepBall",
          g: "F",
          p: ["Stamina_Up_3"],
          l: "11",
        },
      ],
    });
    expect(JSON.stringify(result.payload)).not.toContain("slot-a");
    expect(JSON.stringify(result.payload)).not.toContain("slot-b");
    expect(result.skippedRows).toEqual([]);
  });

  it("skips rows that are not recognized by the current species data", () => {
    const fixture = createPalworldSpeciesFixture();

    const result = createCompactOwnedPalsPayloadFromExtractRows({
      gameData: fixture.gameData,
      rows: [
        {
          instanceId: "merchant",
          characterId: "SalesPerson_Wander",
          gender: "",
          passiveIds: [],
        },
        {
          instanceId: "missing-character-id",
          characterId: "",
          gender: "Male",
          passiveIds: ["Legend"],
        },
      ],
    });

    expect(result.payload).toEqual({
      v: 1,
      pals: [],
    });
    expect(result.skippedRows).toEqual([
      {
        index: 0,
        characterId: "SalesPerson_Wander",
        reason: "unrecognized_species",
      },
      {
        index: 1,
        characterId: "",
        reason: "missing_species",
      },
    ]);
  });
});
