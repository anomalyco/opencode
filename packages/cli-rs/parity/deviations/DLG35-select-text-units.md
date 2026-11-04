# DLG35: select filtering and truncation on accented and non-BMP text

## TypeScript

`DialogSelect` filters with `fuzzysort` (`packages/tui/src/ui/dialog-select.tsx:223-229`). Before it compares,
`fuzzysort` decomposes Latin letters and drops their accents (`remove_accents`), so `é` matches `e`. Titles,
details, and paths are cut with `Locale.truncate`, `truncateLeft`, and `truncateMiddle`
(`packages/tui/src/util/locale.ts:31-79`), which count UTF-16 code units.

## Rust

`select::fuzzy` compares UTF-16 code units as `fuzzysort` does, but keeps accents: `é` does not match `e`. The
truncation helpers count Unicode scalar values, so a title with characters outside the Basic Multilingual Plane,
such as emoji, keeps one more character before the `…` than in TypeScript.

## Reason

Accent folding needs Unicode normalization, which the workspace does not depend on yet. Counting code units
would cut a surrogate pair in half, which TypeScript does and shows as a broken character. P-ORACLE
`U.3/fuzzy` (48 queries over the 244 keybind descriptions, all ASCII) gives the same order on both sides.
