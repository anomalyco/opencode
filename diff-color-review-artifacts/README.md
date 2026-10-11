# Diff color review (temporary)

Review-only material for the diff color PR. This whole commit is dropped before merge: `diff-color-fixture/`,
`diff-color-review-artifacts/`, `packages/session-ui/src/pierre/diff-color-tuning.ts`, and its import in
`packages/session-ui/src/pierre/index.ts`.

## See the example diffs

The fixture baselines are committed; their edits ship as a patch so they show up as uncommitted Git changes.

```sh
git apply diff-color-review-artifacts/fixture-edits.patch
```

Open a session in this worktree, open **Review → Git changes**, and pick a file in `diff-color-fixture/`.
Undo with `git checkout -- diff-color-fixture && git clean -fd diff-color-fixture`.

## Tune colors yourself

With the desktop dev app running from this worktree (`bun run dev:desktop`):

```sh
bun run diff-color-review-artifacts/tuner/server.ts
```

Open http://127.0.0.1:4455 (any browser, or the OpenCode browser pane).

- Every change saves to `diff-color-tuning.ts` (hot-reloaded) and is pushed live into open diffs through the dev
  app's debug port (9222; override with `TUNER_CDP`).
- **Override set**: `Reference` is the committed, read-only set used for this PR (it matches the branch colors, so it
  previews as no change). Editing it saves a copy; use **New** for a blank set. Your sets stay local and untracked.
- “Current” leaves the branch colors untouched. Slots can be an exact color or a v2 token, with opacity.
- **Copy CSS** / **Paste CSS** share a set with someone else; Undo/Redo and per-category toggles are in the toolbar.

`REPORT.md` and the screenshots document the colors before this change; `COLOR-TOKENS.md` lists the diff view's
color tokens and Pierre variables.
