export interface PalworldSpeciesData {
  readonly version: string;
  readonly speciesIds: readonly string[];
  readonly speciesByNormalizedId: Readonly<Record<string, string>>;
}

export function createPalworldSpeciesData(
  version: string,
  speciesIds: readonly string[],
): PalworldSpeciesData {
  return {
    version,
    speciesIds,
    speciesByNormalizedId: Object.fromEntries(
      speciesIds.map((internalId) => [internalId.toLowerCase(), internalId]),
    ),
  };
}

export function normalizePalCharacterId(
  characterId: string,
  gameData: PalworldSpeciesData,
): string | null {
  const raw = characterId.trim();
  if (!raw) return null;

  const exact = gameData.speciesByNormalizedId[raw.toLowerCase()];
  if (exact) return exact;

  if (raw.startsWith("BOSS_")) {
    return (
      gameData.speciesByNormalizedId[raw.slice("BOSS_".length).toLowerCase()] ??
      null
    );
  }

  return null;
}
