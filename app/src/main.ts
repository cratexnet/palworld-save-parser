import { createPalworldSaveParserIframeBridge } from "../../src/iframe-bridge";
import {
  PALWORLD_SAV_MAX_COMPRESSED_BYTES,
  PALWORLD_SAV_MAX_EXPANSION_RATIO,
  PALWORLD_SAV_MAX_FILE_BYTES,
  PALWORLD_SAV_MAX_UNCOMPRESSED_BYTES,
} from "../../src/save-file-header";
import {
  PALWORLD_SAVE_PARSE_TIMEOUT_MS,
  parsePalworldSaveFileInWorker,
} from "../../src/save-parser-worker-client";

const bridge = createPalworldSaveParserIframeBridge({
  limits: {
    maxFileBytes: PALWORLD_SAV_MAX_FILE_BYTES,
    maxCompressedBytes: PALWORLD_SAV_MAX_COMPRESSED_BYTES,
    maxUncompressedBytes: PALWORLD_SAV_MAX_UNCOMPRESSED_BYTES,
    maxExpansionRatio: PALWORLD_SAV_MAX_EXPANSION_RATIO,
    timeoutMs: PALWORLD_SAVE_PARSE_TIMEOUT_MS,
  },
  parseFile: (file, { signal }) =>
    parsePalworldSaveFileInWorker({
      file,
      signal,
      timeoutMs: PALWORLD_SAVE_PARSE_TIMEOUT_MS,
      createWorker: () =>
        new Worker(new URL("./save-parser.worker.ts", import.meta.url), {
          type: "module",
          name: "palworld-save-parser",
        }),
    }),
});

bridge.start();
