# palworld-ooz

`palworld-ooz` is a reduced WebAssembly build of the GPL Oodle decompressor
used to read Palworld save files in the browser. It supports Kraken, Mermaid,
and Leviathan streams. LZNA and Bitknit are intentionally excluded.

## Build

The checked-in `build/ooz.js` is built with Emscripten SDK `3.1.48`:

```bash
docker run --rm \
  --volume "$PWD/vendor/palworld-ooz:/src" \
  --workdir /src \
  emscripten/emsdk:3.1.48 \
  sh -lc 'emcmake cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build'
```

See `NOTICE.md` for the upstream source and modification history.
