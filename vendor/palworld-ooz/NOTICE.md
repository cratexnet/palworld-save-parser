# Upstream and modification notice

This package is derived from `ooz-wasm` by Alexander Drozdov:

- Repository: <https://github.com/SnosMe/ooz-wasm>
- Upstream commit: `ebed82851988add824e092dc4db320c8fa39aaca`
- Upstream package version: `2.0.0`
- License: `GPL-3.0-or-later`

The decompressor implementation in `lib/kraken.cpp` is Copyright (C) 2016,
Powzix and carries its original GPL-3.0-or-later notice.

The Palworld Save Parser fork was created on 2026-07-13. It removes the
upstream LZNA and Bitknit source files and decoder branches because those two
files did not carry explicit copyright or license headers. The retained source
supports decoder types 6 (Kraken), 10 (Mermaid), and 12 (Leviathan). Palworld
1.0 `Level.sav` samples used for verification use decoder type 12.
