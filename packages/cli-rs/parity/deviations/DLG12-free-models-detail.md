# DLG12: the model pickers rank multi-word searches with fuzzysort's per-key score

## TypeScript

`DialogConnectedModels` (`packages/tui/src/component/dialog-model.tsx:182-194`) and `DialogFreeModels`
(`component/dialog-model-free.tsx:39-43`) filter with `fuzzysort.go(needle, options, { keys })`. A search with
spaces is split into words, and each option scores by the words it matches across its keys.

## Rust

The pickers list the same models in the same order, with the same header description, `*` favorite marker,
actions, and `ModelDetail` line below the list. A search with spaces ranks with fuzzysort's per-key default score
instead of its space-split score. Single-word searches rank the same.

## Reason

U.3's `fuzzy::go` takes a score function over per-key scores only. Port the space-split scoring there, then drop
this file.
