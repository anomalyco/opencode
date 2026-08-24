# Links

## Related

- `sustainable-upstream-sync` — this change lowers the per-sync conflict surface that
  the sync strategy is trying to make sustainable. Parity is the precondition.
- `retire-inert-fork-modules` — the sibling sweep. That one removes fork code that does
  nothing; this one removes fork code that duplicates upstream. Same instinct, disjoint
  targets: dead vs. drifted.
- `unify-layer-node-graph` — upstream shipped this refactor; the fork's remaining
  `defaultLayer` surface is the un-migrated tail of it. Phase 3 finishes the adoption.
- `upstream-sync-opencode-dev` — the sync whose "ours" resolution of `package.json`
  produced the Phase 0 breakage. Baseline has since moved to `0d927ba03f`.
