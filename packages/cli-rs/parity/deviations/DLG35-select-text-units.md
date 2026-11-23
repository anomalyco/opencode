# DLG35: select truncation on non-BMP text

## TypeScript

`DialogSelect` cuts titles, details, and paths with `Locale.truncate`, `truncateLeft`, and `truncateMiddle`
(`packages/tui/src/util/locale.ts:31-79`), which count UTF-16 code units.

## Rust

The truncation helpers count Unicode scalar values, so a title with characters outside the Basic Multilingual Plane,
such as emoji, keeps one more character before the `…` than in TypeScript. Filtering matches: `fuzzy` compares
UTF-16 code units and drops accents from Latin letters as `fuzzysort`'s `remove_accents` does, from the table
`script/gen/accents.ts` writes.

## Reason

Counting code units would cut a surrogate pair in half, which TypeScript does and shows as a broken character.
