# DLG12: the free models picker shows no detail line or description

## TypeScript

Under the `new-designs` experiment, with no provider connected, `/models` opens `DialogFreeModels`
(`packages/tui/src/component/dialog-model-free.tsx:11-77`). Its header has the muted description "Connect a
provider for access to more models", and the selected row's `ModelDetail` (input modalities, context window,
"Reasoning") shows below the list. The connected-models picker shows the same detail under `new-designs`.

## Rust

The picker lists the same models in the same order (favorites, then recent, then the server's order), with the
`*` favorite marker and the `connect provider` and `favorite` actions, but without the description and the
detail line.

## Reason

U.3's select has no `detail` slot and no header description yet (both are `new-designs` only in TypeScript).
`new-designs` is off by default and only config turns it on, so the default design is unaffected. Add both to the
select, then drop this file, when the experiment graduates.

Also under this row, for the connected-models picker: a search with spaces ranks with fuzzysort's per-key
default score instead of its space-split score, because U.3's `fuzzy::go` takes a score function over per-key
scores only. Single-word searches rank the same.
