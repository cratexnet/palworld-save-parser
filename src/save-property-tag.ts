export interface PalworldPropertyTagMetadata {
  structType?: string;
  structId?: string;
  arrayType?: string;
  keyType?: string;
  valueType?: string;
  setType?: string;
  enumType?: string;
  boolValue?: boolean;
}

export interface PalworldPropertyTagMetadataReader {
  readFString(): string;
  readGuidString(): string;
  readByte(): number;
  skip(byteLength: number): void;
}

export function readPalworldPropertyTagMetadata(
  type: string,
  reader: PalworldPropertyTagMetadataReader,
): PalworldPropertyTagMetadata {
  const metadata: PalworldPropertyTagMetadata = {};

  switch (type) {
    case "StructProperty":
      metadata.structType = reader.readFString();
      metadata.structId = reader.readGuidString();
      skipOptionalGuid(reader);
      return metadata;
    case "ArrayProperty":
      metadata.arrayType = reader.readFString();
      skipOptionalGuid(reader);
      return metadata;
    case "MapProperty":
      metadata.keyType = reader.readFString();
      metadata.valueType = reader.readFString();
      skipOptionalGuid(reader);
      return metadata;
    case "SetProperty":
      metadata.setType = reader.readFString();
      skipOptionalGuid(reader);
      return metadata;
    case "EnumProperty":
    case "ByteProperty":
      metadata.enumType = reader.readFString();
      skipOptionalGuid(reader);
      return metadata;
    case "BoolProperty":
      metadata.boolValue = reader.readByte() !== 0;
      skipOptionalGuid(reader);
      return metadata;
    default:
      skipOptionalGuid(reader);
      return metadata;
  }
}

function skipOptionalGuid(reader: PalworldPropertyTagMetadataReader) {
  if (reader.readByte() !== 0) {
    reader.skip(16);
  }
}
