import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    license: { fileName: "THIRD_PARTY_LICENSES.txt" },
    modulePreload: false,
    target: "es2022",
  },
  worker: { format: "es" },
});
