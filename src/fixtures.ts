import { createPalworldSpeciesData } from "./game-data-contract";

export function createPalworldSpeciesFixture() {
  const gameData = createPalworldSpeciesData("test-data", [
    "A",
    "B",
    "SheepBall",
  ]);

  return { gameData };
}
