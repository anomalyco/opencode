# Grouped timeline implementation log

## Delivery agreement

Work sequentially, one task at a time. Prefer small independently landable PRs
targeting `v2`. Combine tasks only when necessary for a working integration.
Do not silently change production behavior, even if a difference seems better.
Diagnostic parity fixtures/tests and screenshots are local evidence, not intended
shipping changes unless explicitly agreed.

## Ordered tasks and PR boundaries

| Task | Scope / completion gate | Status | Proposed PR |
| --- | --- | --- | --- |
| 1. Baseline | Record clean revision, run existing checks, inventory behavior and capture real development TUI | Complete; evidence below | Documentation-only baseline PR (`grouped-timeline`) |
| 2. Shared renderers | Extract renderers and shared context from session/index.tsx; preserve layout, subscriptions, defaults and behavior | Not started | `refactor(tui): extract session renderers` |
| 3. Generic engine | Recursive grouping paths, seam merge/split, stable identities, idempotent ingestion, cached leaf counts | Not started | Pure engine + focused tests, independently landable if useful |
| 4. Production integration | Connect store updates to engine with existing reasoning/exploration rules; establish parity before removing old logic | Not started | Engine integration; combine with task 3 if that avoids an unused module |
| 5. Tree rendering/navigation | Recursive rendering, registered message anchors, measured OpenTUI offsets, reveal ancestors | Not started | Combine necessary tree wiring with task 4; remaining navigation work separately |
| 6. History/mounting | Complete boundary groups by fetching backward; stable viewport; leaf-based soft budget | Not started | Group-aware history PR |
| 7. Experiment | Low/Medium/High configuration, activity/instruction groups and agreed summaries/defaults | Not started | Experimental grouping PR |
| 8. End-to-end verification | Full lifecycle, pagination, navigation, replay, long sessions, narrow/wide Drive captures | Not started | Verification accompanies every PR; final integration evidence here |

Task 1 lands as a documentation-only PR from `grouped-timeline` into `v2`.
Task 2 is the next implementation task and will follow in a separate PR.

## Agreed architecture

- One production grouping engine; experiment selects rules/presentation, not a separate session route.
- Tree is the source of truth and renders recursively; no flat rendering projection.
- Existing message types and PartRef conventions remain authoritative.
- Two-level grouping is supported from the start: activity -> exploration/reasoning/instructions -> leaves.
- Shared production thinking/exploration status presentation remains unchanged for default rules.
- Transcript owns message anchors registered by nested renderers. Read actual OpenTUI geometry after layout.
- Leaf counts, not group counts, drive a soft mounting budget. Group wrappers count as zero.
- Summary membership is independent of the mounted slice and disclosure state.
- Fetch backward until the oldest group has a known boundary or history is exhausted.
  Stage incomplete boundary content; reveal complete groups while preserving the reader's anchor.
  No new loading indicator. A very long group may require several pages.
- Register the feature in the existing permanent Experiments framework; preserve that framework.

## Task 1: production baseline

### Revision and environment

- Worktree: `/root/projects/opencode-grouped-timeline`
- Branch: `grouped-timeline`
- Clean starting revision: `8f4d7066473ea07d26c5dfc35e46cd9a94e3e292`
- Subject: `feat(cli): add command docs and simplify session list`
- Created from fetched `origin/v2`; previous verbosity prototype edits remain in the other worktree.
- No production source changes made for this task. Git retains the exact baseline source and existing test fixtures.

### Baseline behavior inventory

Source: `packages/tui/src/routes/session/rows.ts` and `index.tsx` at the revision above.

- Flat row union: messages, compaction-queued, parts, reasoning groups, exploration groups, assistant footers, usage.
- Exploration membership: case-insensitive read/glob/grep; webfetch/websearch remain standalone.
- Adjacent reasoning and exploration can span assistant-message boundaries.
- Empty text/reasoning is skipped during history reduction, but still consumes its per-type ordinal.
- Tool references use call IDs; text/reasoning references use per-type ordinals.
- Visible delimiters finish preceding groups. Terminal/retry assistant footers also finish groups.
- Synthetic messages without a nonblank description are skipped.
- Running compaction and queued input ordering are explicitly handled, not ordinary assistant parts.
- Exploration keeps refs, pending refs and completion state; reasoning keeps refs and completion state.
- Current rendering uses `Exploring — ...` / `Explored — ...`; do not substitute prototype colons during extraction.
- History loading compensates for scroll-height changes after layout; navigation uses message boundaries.
- Initial mounting uses 40 newest rows, with 60-row backfill chunks. Leaf budgeting is future work, not baseline behavior.

### Automated checks executed

Both commands run from `packages/tui`:

```sh
bun typecheck
bun run test
```

- Typecheck: passed.
- Suite: **1352 passed, 4 skipped, 0 failed**, 2 snapshots,
  107855 assertions across 143 files, 107.88 seconds.
- Existing suite emitted resize-listener warnings and teardown/refresh diagnostics
  (including a session-tab lock ENOENT and an UnexpectedStatus). These occurred
  before implementation; the suite exited successfully.
- Full test output retained locally at
  `/root/.local/share/opencode/shell/012780c4098d08caa4ea8c479ed0a4690489f38d/sh_08d3aa8b20014fbv25Iyo7BkR8.out`.

Relevant existing deterministic coverage in `packages/tui/test/cli/tui`:

| File | Baseline coverage |
| --- | --- |
| session-rows.test.ts | Group boundaries, cross-message grouping, empty parts, ordinals, synthetic messages, retry footers, compaction ordering |
| data.test.tsx | Live classification, queued delivery, failures, retry lifecycle, reconnect, revert, permissions/forms, optimistic admission |
| thinking.test.ts | Streamed title extraction and Markdown body preservation |
| session-history.test.ts | Prepend anchoring, failed fetch, session switch during fetch, navigation after layout |
| message-navigation.test.ts | User-only/all-message navigation, slack, bounds, logical anchors during layout |
| inline-tool-wrap-snapshot.test.tsx | Existing tool wrapping snapshots |

These tests establish the current reference, not proof that the future refactor is equivalent.
Each subsequent PR must compare affected outputs against this revision, and add diagnostic
coverage where existing fixtures do not exercise the change.

### Drive evidence

Local diagnostic script: `/tmp/opencode/grouping-baseline.ts`.
It uses a fixed project (`src/example.ts`), simulated reasoning, a real read tool,
and a delayed simulated final response to expose exploration's busy state.

```sh
opencode-drive check /tmp/opencode/grouping-baseline.ts
opencode-drive start --name grouping-baseline-tools \
  --dev /root/projects/opencode-grouped-timeline \
  --script /tmp/opencode/grouping-baseline.ts
```

Both commands passed. Drive shut down its isolated instance on completion.
PNG captures were opened and inspected:

- `/mnt/mail/run-043fc634-307d-46bd-a659-0da2da41521b/generation-0/baseline-exploring.png`: busy exploration, 112x34.
- `/mnt/mail/run-043fc634-307d-46bd-a659-0da2da41521b/generation-0/baseline-wide.png`: completed thought/read/text, 112x34.
- `/mnt/mail/run-043fc634-307d-46bd-a659-0da2da41521b/generation-0/baseline-narrow.png`: same completed state, 80x24.

The fixture's content is deterministic; real durations and spinner frames are not.
These PNGs are visual references, not byte-identical golden assertions. Future
exact layout comparisons need fixed message timestamps and controlled animation.
Long-history behavior is covered by the passing existing suite; expanded groups
and long-history Drive captures must be added before shipping changes to those paths.

## Next PR acceptance: shared-renderer extraction

1. Move code into a few coherent modules; retain JSX structure and behavior.
2. Preserve context/provider ownership and reactive reads; avoid new subscriptions.
3. Compare extracted component bodies to the baseline and run affected render tests.
4. Repeat typecheck and TUI suite; replay Drive fixture and compare layouts.
5. Record diff scope, results, evidence and PR URL here. Keep diagnostic-only files out of the PR.
