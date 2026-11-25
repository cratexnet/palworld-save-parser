import type { PalworldExtractedInventoryRow } from "./extracted-inventory-payload";
import {
  extractPalworldOwnedPalsFromLevelSaveJson,
  type PalworldLevelSaveJsonExtractorOptions,
} from "./save-json-extractor";
import {
  readPalworldPropertyTagMetadata,
  type PalworldPropertyTagMetadata,
  type PalworldPropertyTagMetadataReader,
} from "./save-property-tag";
import {
  PALWORLD_MAX_CHARACTER_MAP_ENTRIES,
  PALWORLD_MAX_COMPACT_ROWS,
  PALWORLD_MAX_CONTAINER_ENTRIES,
  PALWORLD_MAX_CONTAINER_SLOTS,
  PALWORLD_MAX_CUSTOM_VERSIONS,
  PALWORLD_MAX_FSTRING_ENCODED_BYTES,
  PALWORLD_MAX_RAW_CHARACTER_BYTES,
  PALWORLD_MAX_TOTAL_CONTAINER_SLOTS,
} from "./save-parser-limits";

const GVAS_MAGIC = "GVAS";
const utf8Decoder = new TextDecoder();
const utf16Decoder = new TextDecoder("utf-16le");

export class PalworldGvasExtractError extends Error {
  readonly code = "invalid_gvas";
  constructor(message: string) {
    super(message);
    this.name = "PalworldGvasExtractError";
  }
}

export interface PalworldGvasHeader {
  saveGameVersion: number;
  packageFileVersionUe4: number;
  packageFileVersionUe5: number;
  engineVersion: {
    major: number;
    minor: number;
    patch: number;
    changelist: number;
    branch: string;
  };
  customVersionFormat: number;
  customVersionCount: number;
  saveGameClassName: string;
}

interface PalworldGvasPropertyHeader extends PalworldPropertyTagMetadata {
  name: string;
  type: string;
  size: number;
  valueEnd: number;
}

export function extractPalworldOwnedPalsFromGvasPayload(
  payload: Uint8Array,
  options: PalworldLevelSaveJsonExtractorOptions = {},
): PalworldExtractedInventoryRow[] {
  const rows = extractPalworldOwnedPalsFromLevelSaveJson(
    readPalworldLevelSaveGvasSubset(payload),
    options,
  );
  if (rows.length > PALWORLD_MAX_COMPACT_ROWS) {
    throw new PalworldGvasExtractError(
      `Palworld extraction exceeds the ${PALWORLD_MAX_COMPACT_ROWS}-row limit.`,
    );
  }
  return rows;
}

export function readPalworldLevelSaveGvasSubset(payload: Uint8Array) {
  return new PalworldGvasReader(payload).readLevelSaveSubset();
}

class PalworldGvasReader {
  private readonly view: DataView;
  private offset = 0;
  private totalContainerSlots = 0;
  private readonly propertyTagReader: PalworldPropertyTagMetadataReader = {
    readFString: () => this.readFString(),
    readGuidString: () => this.readGuidString(),
    readByte: () => this.readByte(),
    skip: (byteLength) => this.skip(byteLength),
  };

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  readLevelSaveSubset() {
    const header = this.readHeader();
    const properties: Record<string, unknown> = {};

    while (this.offset < this.data.byteLength) {
      const property = this.readPropertyHeader();
      if (!property) break;

      if (
        property.name === "worldSaveData" &&
        property.type === "StructProperty"
      ) {
        properties.worldSaveData = {
          type: property.type,
          value: this.readWorldSaveData(property.valueEnd),
        };
        this.offset = property.valueEnd;
        break;
      }

      this.offset = property.valueEnd;
    }

    return {
      header,
      properties,
    };
  }

  private readHeader(): PalworldGvasHeader {
    const magic = this.readAscii(4);
    if (magic !== GVAS_MAGIC) {
      throw new PalworldGvasExtractError(
        `Palworld GVAS payload has invalid magic: ${magic}.`,
      );
    }

    const header: PalworldGvasHeader = {
      saveGameVersion: this.readInt32(),
      packageFileVersionUe4: this.readInt32(),
      packageFileVersionUe5: this.readInt32(),
      engineVersion: {
        major: this.readUint16(),
        minor: this.readUint16(),
        patch: this.readUint16(),
        changelist: this.readUint32(),
        branch: this.readFString(),
      },
      customVersionFormat: this.readInt32(),
      customVersionCount: this.readUint32(),
      saveGameClassName: "",
    };
    if (header.customVersionCount > PALWORLD_MAX_CUSTOM_VERSIONS) {
      throw new PalworldGvasExtractError(
        `Palworld GVAS custom version count exceeds the ${PALWORLD_MAX_CUSTOM_VERSIONS}-entry limit.`,
      );
    }

    for (let index = 0; index < header.customVersionCount; index += 1) {
      this.skip(16);
      this.skip(4);
    }

    header.saveGameClassName = this.readFString();
    return header;
  }

  private readWorldSaveData(endOffset: number) {
    const value: Record<string, unknown> = {};

    while (this.offset < endOffset) {
      const property = this.readPropertyHeader(endOffset);
      if (!property) break;

      if (
        property.name === "CharacterSaveParameterMap" &&
        property.type === "MapProperty"
      ) {
        value.CharacterSaveParameterMap =
          this.readCharacterSaveParameterMap(property);
        this.offset = property.valueEnd;
      } else if (
        property.name === "CharacterContainerSaveData" &&
        property.type === "MapProperty"
      ) {
        value.CharacterContainerSaveData =
          this.readCharacterContainerSaveData(property);
        this.offset = property.valueEnd;
      } else {
        this.offset = property.valueEnd;
      }
    }

    return value;
  }

  private readCharacterSaveParameterMap(property: PalworldGvasPropertyHeader) {
    if (
      property.keyType !== "StructProperty" ||
      property.valueType !== "StructProperty"
    ) {
      throw new PalworldGvasExtractError(
        "Palworld CharacterSaveParameterMap must use StructProperty keys and values.",
      );
    }

    this.skip(4);
    const count = this.readInt32();
    if (count < 0) {
      throw new PalworldGvasExtractError(
        `Palworld CharacterSaveParameterMap has invalid count ${count}.`,
      );
    }
    if (count > PALWORLD_MAX_CHARACTER_MAP_ENTRIES) {
      throw new PalworldGvasExtractError(
        `Palworld CharacterSaveParameterMap entry limit is ${PALWORLD_MAX_CHARACTER_MAP_ENTRIES}.`,
      );
    }

    const entries: Array<Record<string, unknown>> = [];
    for (let index = 0; index < count; index += 1) {
      entries.push({
        key: this.readCharacterMapKey(property.valueEnd),
        value: this.readCharacterMapValue(property.valueEnd),
      });
    }

    return {
      type: property.type,
      value: entries,
    };
  }

  private readCharacterMapKey(endOffset: number) {
    const key: Record<string, unknown> = {};

    while (this.offset < endOffset) {
      const property = this.readPropertyHeader(endOffset);
      if (!property) break;

      if (
        (property.name === "InstanceId" || property.name === "PlayerUId") &&
        property.type === "StructProperty" &&
        property.structType === "Guid"
      ) {
        key[property.name] = {
          type: property.type,
          value: this.readGuidString(),
        };
      }

      this.offset = property.valueEnd;
    }

    return key;
  }

  private readCharacterMapValue(endOffset: number) {
    const value: Record<string, unknown> = {};

    while (this.offset < endOffset) {
      const property = this.readPropertyHeader(endOffset);
      if (!property) break;

      if (
        property.name === "RawData" &&
        property.type === "ArrayProperty" &&
        property.arrayType === "ByteProperty"
      ) {
        value.RawData = {
          type: property.type,
          value: {
            values: this.readByteArray(property.valueEnd),
          },
        };
      }

      this.offset = property.valueEnd;
    }

    return value;
  }

  private readCharacterContainerSaveData(property: PalworldGvasPropertyHeader) {
    if (
      property.keyType !== "StructProperty" ||
      property.valueType !== "StructProperty"
    ) {
      throw new PalworldGvasExtractError(
        "Palworld CharacterContainerSaveData must use StructProperty keys and values.",
      );
    }

    this.skip(4);
    const count = this.readInt32();
    if (count < 0) {
      throw new PalworldGvasExtractError(
        `Palworld CharacterContainerSaveData has invalid count ${count}.`,
      );
    }
    if (count > PALWORLD_MAX_CONTAINER_ENTRIES) {
      throw new PalworldGvasExtractError(
        `Palworld CharacterContainerSaveData entry limit is ${PALWORLD_MAX_CONTAINER_ENTRIES}.`,
      );
    }

    const entries: Array<Record<string, unknown>> = [];
    for (let index = 0; index < count; index += 1) {
      entries.push({
        key: this.readCharacterContainerMapKey(property.valueEnd),
        value: this.readCharacterContainerMapValue(property.valueEnd),
      });
    }

    return { type: property.type, value: entries };
  }

  private readCharacterContainerMapKey(endOffset: number) {
    const key: Record<string, unknown> = {};

    while (this.offset < endOffset) {
      const property = this.readPropertyHeader(endOffset);
      if (!property) break;

      if (
        property.name === "ID" &&
        property.type === "StructProperty" &&
        property.structType === "Guid"
      ) {
        key.ID = {
          type: property.type,
          value: this.readGuidString(),
        };
      }
      this.offset = property.valueEnd;
    }

    return key;
  }

  private readCharacterContainerMapValue(endOffset: number) {
    const value: Record<string, unknown> = {};

    while (this.offset < endOffset) {
      const property = this.readPropertyHeader(endOffset);
      if (!property) break;

      if (
        property.name === "Slots" &&
        property.type === "ArrayProperty" &&
        property.arrayType === "StructProperty"
      ) {
        value.Slots = {
          type: property.type,
          value: { values: this.readCharacterContainerSlots(property) },
        };
      } else if (
        property.name === "SlotNum" &&
        property.type === "IntProperty"
      ) {
        value.SlotNum = {
          type: property.type,
          value: this.readInt32(),
        };
      }
      this.offset = property.valueEnd;
    }

    return value;
  }

  private readCharacterContainerSlots(property: PalworldGvasPropertyHeader) {
    const count = this.readInt32();
    if (count < 0) {
      throw new PalworldGvasExtractError(
        `Palworld character container has invalid slot count ${count}.`,
      );
    }
    if (count > PALWORLD_MAX_CONTAINER_SLOTS) {
      throw new PalworldGvasExtractError(
        `Palworld per-container slot limit is ${PALWORLD_MAX_CONTAINER_SLOTS}.`,
      );
    }
    if (this.totalContainerSlots + count > PALWORLD_MAX_TOTAL_CONTAINER_SLOTS) {
      throw new PalworldGvasExtractError(
        `Palworld total container slot limit is ${PALWORLD_MAX_TOTAL_CONTAINER_SLOTS}.`,
      );
    }
    this.totalContainerSlots += count;

    this.readFString();
    this.readFString();
    this.readUint64();
    this.readFString();
    this.skip(16);
    this.skipOptionalGuid();

    const slots: Array<Record<string, unknown>> = [];
    for (let index = 0; index < count; index += 1) {
      const slot: Record<string, unknown> = {};
      while (this.offset < property.valueEnd) {
        const slotProperty = this.readPropertyHeader(property.valueEnd);
        if (!slotProperty) break;

        if (
          slotProperty.name === "SlotIndex" &&
          slotProperty.type === "IntProperty"
        ) {
          slot.SlotIndex = {
            type: slotProperty.type,
            value: this.readInt32(),
          };
        } else if (
          slotProperty.name === "RawData" &&
          slotProperty.type === "ArrayProperty" &&
          slotProperty.arrayType === "ByteProperty"
        ) {
          slot.RawData = {
            type: slotProperty.type,
            value: { values: this.readByteArray(slotProperty.valueEnd) },
          };
        }
        this.offset = slotProperty.valueEnd;
      }
      slots.push(slot);
    }

    return slots;
  }

  private readPropertyHeader(
    endOffset = this.data.byteLength,
  ): PalworldGvasPropertyHeader | null {
    const name = this.readFString();
    if (name === "None") return null;

    const type = this.readFString();
    const size = this.readUint64();
    const metadata = readPalworldPropertyTagMetadata(
      type,
      this.propertyTagReader,
    );
    const property: PalworldGvasPropertyHeader = {
      name,
      type,
      size,
      valueEnd: 0,
      ...metadata,
    };

    property.valueEnd = this.offset + size;
    this.assertOffset(property.valueEnd, `${name} value`);
    if (property.valueEnd > endOffset) {
      throw new PalworldGvasExtractError(
        `Palworld GVAS ${name} value exceeds its containing property.`,
      );
    }
    return property;
  }

  private readByteArray(valueEnd: number) {
    const count = this.readInt32();
    if (count < 0) {
      throw new PalworldGvasExtractError(
        `Palworld byte array has invalid count ${count}.`,
      );
    }
    if (count > PALWORLD_MAX_RAW_CHARACTER_BYTES) {
      throw new PalworldGvasExtractError(
        `Palworld RawData exceeds the ${PALWORLD_MAX_RAW_CHARACTER_BYTES}-byte limit.`,
      );
    }
    if (this.offset + count > valueEnd) {
      throw new PalworldGvasExtractError(
        "Palworld byte array is longer than its declared property value.",
      );
    }

    const values = this.data.subarray(this.offset, this.offset + count);
    this.offset += count;
    return values;
  }

  private skipOptionalGuid() {
    if (this.readByte() !== 0) {
      this.skip(16);
    }
  }

  private readFString() {
    const length = this.readInt32();
    if (length === 0) return "";

    if (length < 0) {
      const codeUnitCount = -length;
      if (codeUnitCount > Math.floor(PALWORLD_MAX_FSTRING_ENCODED_BYTES / 2)) {
        throw new PalworldGvasExtractError(
          `Palworld FString exceeds the ${PALWORLD_MAX_FSTRING_ENCODED_BYTES}-byte encoded limit.`,
        );
      }
      const encodedBytes = codeUnitCount * 2;
      this.assertReadable(encodedBytes, "UTF-16 FString");
      const bytes = this.data.subarray(
        this.offset,
        this.offset + encodedBytes - 2,
      );
      this.offset += encodedBytes;
      return utf16Decoder.decode(bytes);
    }

    if (length > PALWORLD_MAX_FSTRING_ENCODED_BYTES) {
      throw new PalworldGvasExtractError(
        `Palworld FString exceeds the ${PALWORLD_MAX_FSTRING_ENCODED_BYTES}-byte encoded limit.`,
      );
    }
    this.assertReadable(length, "UTF-8 FString");
    const bytes = this.data.subarray(this.offset, this.offset + length - 1);
    this.offset += length;
    return utf8Decoder.decode(bytes);
  }

  private readGuidString() {
    const hex = [
      this.readUint32(),
      this.readUint32(),
      this.readUint32(),
      this.readUint32(),
    ]
      .map((part) => part.toString(16).padStart(8, "0"))
      .join("");

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  private readAscii(byteLength: number) {
    this.assertReadable(byteLength, "ASCII");
    const value = String.fromCharCode(
      ...this.data.subarray(this.offset, this.offset + byteLength),
    );
    this.offset += byteLength;
    return value;
  }

  private readByte() {
    this.assertReadable(1, "byte");
    const value = this.data[this.offset];
    this.offset += 1;
    return value;
  }

  private readInt32() {
    this.assertReadable(4, "int32");
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  private readUint16() {
    this.assertReadable(2, "uint16");
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  private readUint32() {
    this.assertReadable(4, "uint32");
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  private readUint64() {
    const low = this.readUint32();
    const high = this.readUint32();
    const value = high * 0x100000000 + low;
    if (!Number.isSafeInteger(value)) {
      throw new PalworldGvasExtractError(
        "Palworld GVAS uint64 exceeds JavaScript safe integer range.",
      );
    }
    return value;
  }

  private skip(byteLength: number) {
    this.assertReadable(byteLength, "skipped bytes");
    this.offset += byteLength;
  }

  private assertReadable(byteLength: number, label: string) {
    this.assertOffset(this.offset + byteLength, label);
  }

  private assertOffset(offset: number, label: string) {
    if (offset > this.data.byteLength) {
      throw new PalworldGvasExtractError(
        `Palworld GVAS ${label} is truncated.`,
      );
    }
  }
}
