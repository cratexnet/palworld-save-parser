import {
  readPalworldPropertyTagMetadata,
  type PalworldPropertyTagMetadataReader,
} from "./save-property-tag";
import {
  PALWORLD_MAX_FSTRING_ENCODED_BYTES,
  PALWORLD_MAX_RAW_CHARACTER_ARRAY_ITEMS,
  PALWORLD_MAX_RAW_CHARACTER_BYTES,
  PALWORLD_MAX_RAW_CHARACTER_PROPERTIES,
  PALWORLD_MAX_RAW_CHARACTER_RECURSION_DEPTH,
} from "./save-parser-limits";

export interface PalworldRawCharacterDecodedProperty {
  type: string;
  value?: unknown;
  values?: unknown[];
  enum_type?: string;
  inner_type?: string;
  struct_id?: string;
  struct_type?: string;
  key_type?: string;
  value_type?: string;
}

export type PalworldRawCharacterDecodedProperties = Record<
  string,
  PalworldRawCharacterDecodedProperty
>;

const utf8Decoder = new TextDecoder();
const utf16Decoder = new TextDecoder("utf-16le");

export class PalworldRawCharacterDecodeError extends Error {
  readonly code = "invalid_raw_character_data";
  constructor(message: string) {
    super(message);
    this.name = "PalworldRawCharacterDecodeError";
  }
}

export function decodePalworldRawCharacterSaveParameter(
  rawValues: readonly number[] | Uint8Array,
): PalworldRawCharacterDecodedProperties {
  return new PalworldRawCharacterReader(
    toUint8Array(rawValues),
  ).readPropertyList();
}

class PalworldRawCharacterReader {
  private readonly view: DataView;
  private offset = 0;
  private propertyCount = 0;
  private recognizedArrayItemCount = 0;
  private readonly propertyTagReader: PalworldPropertyTagMetadataReader = {
    readFString: () => this.readFString(),
    readGuidString: () => this.readGuidString(),
    readByte: () => this.readByte(),
    skip: (byteLength) => this.skip(byteLength),
  };

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  readPropertyList(endOffset = this.data.byteLength, recursionDepth = 0) {
    if (recursionDepth > PALWORLD_MAX_RAW_CHARACTER_RECURSION_DEPTH) {
      throw new PalworldRawCharacterDecodeError(
        `Palworld raw character recursion depth exceeds ${PALWORLD_MAX_RAW_CHARACTER_RECURSION_DEPTH}.`,
      );
    }

    const properties: PalworldRawCharacterDecodedProperties = {};
    while (this.offset < endOffset) {
      const name = this.readFString();
      if (name === "None") {
        return properties;
      }

      this.propertyCount += 1;
      if (this.propertyCount > PALWORLD_MAX_RAW_CHARACTER_PROPERTIES) {
        throw new PalworldRawCharacterDecodeError(
          `Palworld RawData exceeds the ${PALWORLD_MAX_RAW_CHARACTER_PROPERTIES}-property limit.`,
        );
      }
      properties[name] = this.readPropertyValue(endOffset, recursionDepth);
    }

    throw new PalworldRawCharacterDecodeError(
      "Palworld raw character property list is missing the None terminator.",
    );
  }

  private readPropertyValue(
    endOffset: number,
    recursionDepth: number,
  ): PalworldRawCharacterDecodedProperty {
    const type = this.readFString();
    const size = this.readInt64();
    const metadata = readPalworldPropertyTagMetadata(
      type,
      this.propertyTagReader,
    );
    const valueStart = this.offset;
    const valueEnd = valueStart + size;
    this.assertOffset(valueEnd, "property value");
    if (valueEnd > endOffset) {
      throw new PalworldRawCharacterDecodeError(
        `Palworld raw character ${type} value exceeds its containing property.`,
      );
    }

    const property: PalworldRawCharacterDecodedProperty = { type };
    const innerType = metadata.arrayType ?? metadata.setType;
    if (metadata.enumType) property.enum_type = metadata.enumType;
    if (innerType) property.inner_type = innerType;
    if (metadata.keyType) property.key_type = metadata.keyType;
    if (metadata.valueType) property.value_type = metadata.valueType;
    if (metadata.structId) property.struct_id = metadata.structId;
    if (metadata.structType) property.struct_type = metadata.structType;

    if (type === "NameProperty" || type === "StrProperty") {
      property.value = this.readFString();
    } else if (type === "EnumProperty") {
      property.value = this.readFString();
    } else if (type === "ArrayProperty") {
      property.value = this.readArrayValue(metadata.arrayType, valueEnd);
    } else if (type === "StructProperty") {
      property.value = this.readStructValue(
        metadata.structType,
        valueEnd,
        recursionDepth,
      );
    } else if (type === "IntProperty") {
      property.value = this.readInt32();
    } else if (type === "Int64Property") {
      property.value = this.readInt64();
    } else if (type === "FloatProperty") {
      property.value = this.readFloat32();
    } else if (type === "ByteProperty") {
      property.value = this.readByte();
    } else if (type === "BoolProperty") {
      property.value = metadata.boolValue ?? false;
    }

    this.offset = valueEnd;
    return property;
  }

  private readArrayValue(innerType: string | undefined, valueEnd: number) {
    const count = this.readInt32();
    if (count < 0) {
      throw new PalworldRawCharacterDecodeError(
        `Palworld raw character array has invalid count ${count}.`,
      );
    }

    if (innerType !== "NameProperty" && innerType !== "EnumProperty") {
      this.offset = valueEnd;
      return { values: [] };
    }
    if (
      this.recognizedArrayItemCount + count >
      PALWORLD_MAX_RAW_CHARACTER_ARRAY_ITEMS
    ) {
      throw new PalworldRawCharacterDecodeError(
        `Palworld RawData exceeds the ${PALWORLD_MAX_RAW_CHARACTER_ARRAY_ITEMS}-recognized array item limit.`,
      );
    }
    this.recognizedArrayItemCount += count;

    const values: PalworldRawCharacterDecodedProperty[] = [];
    for (let index = 0; index < count; index += 1) {
      values.push({
        type: innerType,
        value: this.readFString(),
      });
    }

    return { values };
  }

  private readStructValue(
    structType: string | undefined,
    valueEnd: number,
    recursionDepth: number,
  ): unknown {
    if (structType === "Guid") {
      return this.readGuidString();
    }

    if (
      structType === "PalIndividualCharacterSaveParameter" ||
      structType === "PalCharacterSlotId" ||
      structType === "PalContainerId"
    ) {
      return this.readPropertyList(valueEnd, recursionDepth + 1);
    }

    this.offset = valueEnd;
    return undefined;
  }

  private readFString() {
    const length = this.readInt32();
    if (length === 0) return "";

    if (length < 0) {
      const codeUnitCount = -length;
      if (codeUnitCount > Math.floor(PALWORLD_MAX_FSTRING_ENCODED_BYTES / 2)) {
        throw new PalworldRawCharacterDecodeError(
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
      throw new PalworldRawCharacterDecodeError(
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

  private readUint32() {
    this.assertReadable(4, "uint32");
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  private readInt64() {
    const low = this.readUint32();
    const high = this.readUint32();
    const value = high * 0x100000000 + low;
    if (!Number.isSafeInteger(value)) {
      throw new PalworldRawCharacterDecodeError(
        "Palworld raw character int64 exceeds JavaScript safe integer range.",
      );
    }
    return value;
  }

  private readFloat32() {
    this.assertReadable(4, "float32");
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
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
      throw new PalworldRawCharacterDecodeError(
        `Palworld raw character ${label} is truncated.`,
      );
    }
  }
}

function toUint8Array(rawValues: readonly number[] | Uint8Array) {
  if (
    !Number.isSafeInteger(rawValues.length) ||
    rawValues.length > PALWORLD_MAX_RAW_CHARACTER_BYTES
  ) {
    throw new PalworldRawCharacterDecodeError(
      `Palworld RawData exceeds the ${PALWORLD_MAX_RAW_CHARACTER_BYTES}-byte limit.`,
    );
  }

  if (rawValues instanceof Uint8Array) {
    return rawValues;
  }

  for (const value of rawValues) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new PalworldRawCharacterDecodeError(
        "Palworld raw character values must be bytes.",
      );
    }
  }
  return Uint8Array.from(rawValues);
}
