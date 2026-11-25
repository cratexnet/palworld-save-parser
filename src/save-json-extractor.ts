import type { PalworldExtractedInventoryRow } from "./extracted-inventory-payload";
import { decodePalworldRawCharacterSaveParameter } from "./save-raw-character-decoder";

export const DEFAULT_PALWORLD_PLAYER_UID =
  "00000000-0000-0000-0000-000000000001";

export type PalworldRawByteArray = readonly number[] | Uint8Array;

export interface PalworldRawCharacterDecodeContext {
  index: number;
  instanceId: string;
  mapPlayerUid: string;
  rawValues: PalworldRawByteArray;
}

export type PalworldRawCharacterDecoder = (
  rawValues: PalworldRawByteArray,
  context: PalworldRawCharacterDecodeContext,
) => unknown;

export interface PalworldLevelSaveJsonExtractorOptions {
  playerUid?: string;
  decodeRawCharacter?: PalworldRawCharacterDecoder;
}

export function extractPalworldOwnedPalsFromLevelSaveJson(
  levelSaveJson: unknown,
  options: PalworldLevelSaveJsonExtractorOptions = {},
): PalworldExtractedInventoryRow[] {
  const playerUid = options.playerUid ?? DEFAULT_PALWORLD_PLAYER_UID;
  const decodeRawCharacter =
    options.decodeRawCharacter ?? decodePalworldRawCharacterSaveParameter;
  const entries = readCharacterSaveParameterMap(levelSaveJson);
  const playerContainerSlots = readPlayerCharacterContainerSlots(
    levelSaveJson,
    playerUid,
  );
  const rows: PalworldExtractedInventoryRow[] = [];

  entries.forEach((entry, index) => {
    const object = asRecord(entry);
    if (!object) return;

    const key = asRecord(object.key);
    const instanceId = toOptionalString(unwrapSaveJsonValue(key?.InstanceId));
    const mapPlayerUid = toOptionalString(unwrapSaveJsonValue(key?.PlayerUId));
    const rawValues = readRawDataValues(object.value);
    if (!rawValues) return;

    const decoded = decodeRawCharacter(rawValues, {
      index,
      instanceId,
      mapPlayerUid,
      rawValues,
    });
    const saveParameter = readSaveParameter(decoded);
    if (!saveParameter) return;

    const characterId = toOptionalString(
      unwrapSaveJsonValue(saveParameter.CharacterID),
    );
    const ownerPlayerUid = toOptionalString(
      unwrapSaveJsonValue(saveParameter.OwnerPlayerUId),
    );
    const isPlayer = toBoolean(unwrapSaveJsonValue(saveParameter.IsPlayer));
    const containerSlot = playerContainerSlots.get(instanceId.toLowerCase());
    const ownerIsEmpty = !ownerPlayerUid || isEmptyGuid(ownerPlayerUid);

    if (
      (ownerPlayerUid !== playerUid && !(ownerIsEmpty && containerSlot)) ||
      !characterId ||
      isPlayer
    ) {
      return;
    }

    const slot = asRecord(unwrapSaveJsonValue(saveParameter.SlotId));
    const containerId = readContainerId(slot);
    rows.push({
      instanceId,
      characterId,
      gender: unwrapSaveJsonValue(saveParameter.Gender),
      passiveIds: readPassiveIds(saveParameter.PassiveSkillList),
      ...(containerId ? { containerId } : {}),
      ...(containerSlot?.containerType
        ? { containerType: containerSlot.containerType }
        : {}),
      slotIndex:
        containerSlot?.slotIndex ?? unwrapSaveJsonValue(slot?.SlotIndex),
    });
  });

  return rows;
}

interface PlayerCharacterContainerSlot {
  containerType: "party" | "palbox" | "base" | "other";
  slotIndex: unknown;
}

function readPlayerCharacterContainerSlots(
  levelSaveJson: unknown,
  playerUid: string,
) {
  const root = asRecord(levelSaveJson);
  const properties = asRecord(root?.properties);
  const worldSaveData = asRecord(properties?.worldSaveData);
  const worldSaveValue = asRecord(worldSaveData?.value);
  const containerData = asRecord(worldSaveValue?.CharacterContainerSaveData);
  const entries = containerData?.value;
  const slotsByInstanceId = new Map<string, PlayerCharacterContainerSlot>();
  if (!Array.isArray(entries)) return slotsByInstanceId;

  for (const entry of entries) {
    const object = asRecord(entry);
    const value = asRecord(object?.value);
    const slotNum = Number(unwrapSaveJsonValue(value?.SlotNum));
    const slots = readContainerSlots(value?.Slots);

    for (const slotValue of slots) {
      const slot = asRecord(slotValue);
      const rawValues = readRawByteArray(slot?.RawData);
      if (!rawValues || rawValues.length < 32) continue;

      const slotPlayerUid = readGuidFromBytes(rawValues, 0);
      const instanceId = readGuidFromBytes(rawValues, 16);
      if (!sameGuid(slotPlayerUid, playerUid) || isEmptyGuid(instanceId)) {
        continue;
      }

      slotsByInstanceId.set(instanceId.toLowerCase(), {
        containerType: classifyCharacterContainer(slotNum),
        slotIndex: unwrapSaveJsonValue(slot?.SlotIndex),
      });
    }
  }

  return slotsByInstanceId;
}

function readContainerSlots(value: unknown) {
  const unwrapped = unwrapSaveJsonValue(value);
  if (Array.isArray(unwrapped)) return unwrapped;
  const object = asRecord(unwrapped);
  return Array.isArray(object?.values) ? object.values : [];
}

function readRawByteArray(value: unknown): PalworldRawByteArray | null {
  const unwrapped = unwrapSaveJsonValue(value);
  const object = asRecord(unwrapped);
  const values =
    unwrapped instanceof Uint8Array || Array.isArray(unwrapped)
      ? unwrapped
      : object?.values instanceof Uint8Array || Array.isArray(object?.values)
        ? object.values
        : null;
  if (!values) return null;

  for (const item of values) {
    if (!Number.isInteger(item) || Number(item) < 0 || Number(item) > 255) {
      return null;
    }
  }
  return values;
}

function readGuidFromBytes(values: PalworldRawByteArray, offset: number) {
  const hex = [0, 4, 8, 12]
    .map((wordOffset) => {
      const start = offset + wordOffset;
      return (
        (values[start] |
          (values[start + 1] << 8) |
          (values[start + 2] << 16) |
          (values[start + 3] << 24)) >>>
        0
      )
        .toString(16)
        .padStart(8, "0");
    })
    .join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function classifyCharacterContainer(slotNum: number) {
  if (slotNum === 5) return "party" as const;
  if (slotNum === 15) return "base" as const;
  if (slotNum === 960) return "palbox" as const;
  return "other" as const;
}

function sameGuid(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function isEmptyGuid(value: string) {
  return value.toLowerCase() === "00000000-0000-0000-0000-000000000000";
}

function readCharacterSaveParameterMap(levelSaveJson: unknown) {
  const root = asRecord(levelSaveJson);
  const properties = asRecord(root?.properties);
  const worldSaveData = asRecord(properties?.worldSaveData);
  const worldSaveValue = asRecord(worldSaveData?.value);
  const characterSaveParameterMap = asRecord(
    worldSaveValue?.CharacterSaveParameterMap,
  );
  const entries = characterSaveParameterMap?.value;
  return Array.isArray(entries) ? entries : [];
}

function readRawDataValues(entryValue: unknown): PalworldRawByteArray | null {
  const value = asRecord(entryValue);
  const rawData = asRecord(value?.RawData);
  const rawDataValue = asRecord(rawData?.value);
  const values = rawDataValue?.values;
  if (!(values instanceof Uint8Array) && !Array.isArray(values)) return null;

  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
  }
  return values;
}

function readSaveParameter(decoded: unknown) {
  const decodedObject = asRecord(decoded);
  const saveParameter = decodedObject?.SaveParameter;
  const saveParameterObject = asRecord(saveParameter);
  const value =
    saveParameterObject && "value" in saveParameterObject
      ? saveParameterObject.value
      : (saveParameter ?? decoded);
  const unwrapped = unwrapSaveJsonValue(value);
  return asRecord(unwrapped);
}

function readPassiveIds(value: unknown) {
  const unwrapped = unwrapSaveJsonValue(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.map(toOptionalString).filter(Boolean);
  }
  const text = toOptionalString(unwrapped);
  return text ? [text] : [];
}

function readContainerId(slot: Record<string, unknown> | null) {
  const container = asRecord(unwrapSaveJsonValue(slot?.ContainerId));
  return unwrapSaveJsonValue(container?.ID);
}

function unwrapSaveJsonValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return value;

  if (Array.isArray(value)) {
    return value.map(unwrapSaveJsonValue);
  }

  const object = asRecord(value);
  if (!object) return value;

  if ("type" in object && "value" in object) {
    return unwrapSaveJsonValue(object.value);
  }

  if (
    "value" in object &&
    Object.keys(object).every((key) =>
      ["value", "id", "struct_id", "struct_type"].includes(key),
    )
  ) {
    return unwrapSaveJsonValue(object.value);
  }

  if (
    Array.isArray(object.values) &&
    Object.keys(object).every((key) =>
      ["values", "id", "struct_id", "struct_type"].includes(key),
    )
  ) {
    return object.values.map(unwrapSaveJsonValue);
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
    if (key === "id" || key === "struct_id" || key === "struct_type") {
      continue;
    }
    result[key] = unwrapSaveJsonValue(child);
  }
  return result;
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

function toOptionalString(value: unknown) {
  if (value == null) return "";
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
