# Palworld Save Parser

A dedicated browser parser for Palworld `Level.sav` files. Save bytes are read
locally, parsed in a short-lived Web Worker, and reduced to an anonymous compact
payload. The application has no server-side parser and does not upload saves.

This repository is licensed under `GPL-3.0-or-later`. See `LICENSE`, `COPYRIGHT`,
and `THIRD_PARTY_NOTICES.md`.

## Privacy and security boundary

- The parser accepts a save only through the documented iframe message channel.
- Parsing runs in a Web Worker with a 60-second timeout and abort support.
- At most 128 MiB of save input and compressed payload, 256 MiB of decompressed
  payload, and a 128:1 expansion ratio are accepted.
- zlib saves use `fflate`. The vendored Ooz WebAssembly decoder is loaded only
  for Oodle-compressed saves.
- Results contain anonymous sequential IDs (`pal-1`, `pal-2`, ...), canonical
  species IDs, gender, passive IDs, and compact slot labels. They never contain
  raw bytes, filenames, player names, player identifiers, or coordinates.
- The browser shell's Content Security Policy permits only same-origin scripts,
  workers, and WebAssembly loading. The embedding CrateX.app page permits the
  same-origin parser frame. Parser code performs no application network
  requests.

## iframe protocol

The message channel is the literal `palworld-save-parser`, protocol version `1`.
A parent sends either:

```ts
{ channel, v: 1, type: "parse", requestId, file }
{ channel, v: 1, type: "cancel", requestId }
```

The iframe sends `ready`, `result`, or `error`. A result contains
`prepared: CompactOwnedPalsPayload`; errors expose only a machine-readable code.
The iframe derives one allowed parent origin from `document.referrer`, accepts
messages only from `window.parent` at that exact origin, and posts only to that
origin. A newer parse cancels the active parse.

## Library API

The root package exports the save limits, header/decompression/GVAS/RawData
parsers, ID-only species data, compact payload types, stable error codes, and
Worker client. `palworld-save-parser/ooz-wasm` and
`palworld-save-parser/worker-client` provide focused subpath exports.

`parsePalworldSaveFileInWorker` accepts a `Blob`, a Worker factory, and optional
`AbortSignal`/timeout values. The Worker factory should create
`app/src/save-parser.worker.ts` as a module Worker in browser bundles.

## Browser distribution

`pnpm build:app` places the iframe application in `dist-app` together with the
GPL license, third-party license texts, build hashes, an exact source manifest,
and a complete corresponding-source archive. All distribution links are
relative so the output can be mounted without rewriting at
`/games/palworld/breeding/parser/`. `pnpm build:release` additionally requires
the source tree to be committed and clean. This repository produces the static
artifact only; CrateX.app builds and publishes it with the calculator.

## Commands

```text
pnpm install
pnpm type-check
pnpm test
pnpm build
pnpm build:app
pnpm build:release
pnpm smoke:real-save -- /path/to/Level.sav
```

The smoke command requires a real local save path. It prints only the header,
data/payload versions, compact row count, and privacy invariants; it never
prints save contents or identifiers.

## Vendor source

`vendor/palworld-ooz` contains the checked-in WebAssembly build and the complete
preferred source needed to rebuild it. Rebuild instructions, exact upstream
commit, modifications, and licensing are recorded inside that directory.
