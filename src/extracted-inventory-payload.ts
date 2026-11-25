import {
  normalizePalCharacterId,
  type PalworldSpeciesData,
} from "./game-data-contract";
import type {
  CompactOwnedPalRow,
  CompactOwnedPalsPayload,
} from "./owned-pals-payload";
import { PALWORLD_OWNED_PALS_PAYLOAD_VERSION } from "./owned-pals-payload";

export interface PalworldExtractedInventoryRow {
  instanceId?: unknown;
  characterId?: unknown;
  gender?: unknown;
  passiveIds?: unknown;
  containerId?: unknown;
  containerType?: unknown;
  slotIndex?: unknown;
}

export type PalworldExtractedInventorySkipReason =
  "missing_species" | "unrecognized_species";

export interface PalworldExtractedInventorySkippedRow {
  index: number;
  characterId: string;
  reason: PalworldExtractedInventorySkipReason;
}

export interface PalworldExtractedInventoryPayloadResult {
  payload: CompactOwnedPalsPayload;
  skippedRows: readonly PalworldExtractedInventorySkippedRow[];
}

export function createCompactOwnedPalsPayloadFromExtractRows(input: {
  rows: readonly PalworldExtractedInventoryRow[];
  gameData?: PalworldSpeciesData;
}): PalworldExtractedInventoryPayloadResult {
  const pals: CompactOwnedPalRow[] = [];
  const skippedRows: PalworldExtractedInventorySkippedRow[] = [];

  input.rows.forEach((row, index) => {
    const characterId = optionalString(row.characterId).trim();
    if (!characterId) {
      skippedRows.push({
        index,
        characterId,
        reason: "missing_species",
      });
      return;
    }

    const species = input.gameData
      ? normalizePalCharacterId(characterId, input.gameData)
      : characterId;
    if (!species) {
      skippedRows.push({
        index,
        characterId,
        reason: "unrecognized_species",
      });
      return;
    }

    const slotIndex = optionalString(row.slotIndex).trim();
    const containerType = optionalString(row.containerType).trim();
    pals.push({
      i: `pal-${pals.length + 1}`,
      s: species,
      g: compactGender(row.gender),
      p: passiveIds(row.passiveIds),
      ...(slotIndex
        ? { l: containerType ? `${containerType}:${slotIndex}` : slotIndex }
        : {}),
    });
  });

  return {
    payload: {
      v: PALWORLD_OWNED_PALS_PAYLOAD_VERSION,
      pals,
    },
    skippedRows,
  };
}

function compactGender(value: unknown) {
  const normalized = optionalString(value)
    .replace(/^EPalGenderType::/, "")
    .trim()
    .toLowerCase();
  if (normalized === "male" || normalized === "m") return "M";
  if (normalized === "female" || normalized === "f") return "F";
  return "";
}

function passiveIds(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(optionalString)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const text = optionalString(value).trim();
  if (!text) return [];
  return text
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalString(value: unknown) {
  if (value == null) return "";
  return String(value);
}
