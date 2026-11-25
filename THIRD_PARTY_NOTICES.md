# Third-party notices

## Palworld species IDs

The canonical Palworld v1 internal species ID list is generated from the public
catalog derived from `tylercamp/palcalc` commit
`431b217b0f78bbef400baaa3aea20c8e99e9444c`, Copyright 2024 Tyler Camp, under
the MIT License. The complete license text is preserved in
`src/data/palworld-v1.LICENSE.txt`.

Only canonical internal IDs and the source data version are retained. Display
names, levels, rarity, passive-skill catalogs, and breeding formulas are not
included.

## Palworld Oodle decoder

`vendor/palworld-ooz` is derived from `SnosMe/ooz-wasm` commit
`ebed82851988add824e092dc4db320c8fa39aaca`, package version `2.0.0`, by
Alexander Drozdov under `GPL-3.0-or-later`.

The retained decompressor implementation in `vendor/palworld-ooz/lib/kraken.cpp`
is Copyright (C) 2016, Powzix and includes its original GPL notice. The source
was modified on 2026-07-13 to remove the LZNA and Bitknit decoder paths. The
fork retains decoder types 6 (Kraken), 10 (Mermaid), and 12 (Leviathan). See
`vendor/palworld-ooz/NOTICE.md` for the complete upstream and modification
record and `vendor/palworld-ooz/LICENSE` for the GPL text.

The checked-in `vendor/palworld-ooz/build/ooz.js` is the reproducible Emscripten
build described in `vendor/palworld-ooz/README.md`; the preferred source form is
retained beside it.

## fflate

Browser zlib decompression uses `fflate`, distributed under the MIT License.
Vite includes its copyright and license text in the generated browser build
license file. Distributions of the browser build must retain that generated
file together with this notice and the GPL materials above.

## Trademark notice

Palworld is a trademark of Pocketpair, Inc. This unofficial project is not
affiliated with or endorsed by Pocketpair. No Palworld artwork, icons, or game
UI assets are included.
