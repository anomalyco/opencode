# Tasks: retire-inert-fork-modules

## Phase 1: Sweep

- [x] 1.1 Enumerate modules under `packages/*/src` with no inbound import specifier
  - Excluded `node_modules`, `dist`, and generated `gen/` trees
  - Result: 19 candidates
- [x] 1.2 Resolve the `imports`/`exports` condition false positives
  - `sqlite.bun.ts`, `sqlite.node.ts`, `pty.bun.ts`, `pty.node.ts`, `fff.node.ts` are all
    reached through `core/package.json` `imports` (`#sqlite`, `#pty`, `#fff`). No import
    specifier names them, so any naive scan condemns them. **Live — 5 candidates dropped.**
- [x] 1.3 Split the remaining 14 by origin with `git cat-file -e upstream/dev:<path>`
  - 11 upstream, 3 fork-owned
- [x] 1.4 Audit fork-owned services for the auto-reply shape (defined, never registered)
  - Every fork service except `scheduler` has importers. `beads`, `side-question`,
    `auto-mode/service`, `loop` are all live.
- [x] 1.5 Audit registered fork CLI commands for no-op behaviour
  - `loop` and `beads` do real work. `hook` does not — see 2.4.

## Phase 2: Remove

- [x] 2.1 Delete `opencode/src/scheduler/`
  - Service, no importer, absent from the node list. Deferred here by `retire-auto-reply` 1.3.
- [x] 2.2 Delete `opencode/src/session/event-error.ts`
  - No importer. Distinct from `ProviderShared.eventError` in `packages/llm`, which is live.
- [x] 2.3 Delete `tui/src/util/auto-mode.ts`
  - The `manual / skip-ask / continue / auto` ladder, orphaned when that UI was removed.
- [x] 2.4 Delete `opencode/src/cli/cmd/hook.ts` and unregister it
  - Its entire behaviour was printing "hooks are configured in your opencode config file
    under the 'hooks' key". There is no `hooks` key in the config schema. Plugin hooks
    exist and are configured under `plugin`. A command described as "manage opencode
    hooks" managed nothing and pointed at a key that does not exist.
  - Considered fixing the message instead. Rejected: the command would still manage
    nothing, and `--help` would still offer it as though it did.
- [x] 2.5 Retain the 11 upstream files, recorded in the proposal
  - Deleting an upstream file costs a conflict on every sync and buys nothing.

## Phase 2A: The opposite finding

- [x] 2.6 Register `opencode beads`
  - Found only after 2.4, by noticing `beads` was missing from `--help`. My file-reference
    scan missed it: `cli/cmd/beads.ts` "matched" because the live `beads/` service
    directory shares the name. A false negative in the sweep, worth knowing about.
  - `BeadsCommand` was exported and never imported — not in `ForkCommands`, not in
    `index.ts`. 194 lines of working code over the live `BeadsSync` service, unreachable.
  - **Registered, not deleted.** Unreferenced and useless are different findings with
    opposite actions: `hook` was reachable and did nothing, this does something real and
    was not reachable. Deleting it would have destroyed working code to satisfy the rule.
  - Verified live: `beads status` reports the bd CLI and beads dir, `beads list` returns
    "No linked beads tasks", and `beads --help` lists status/sync/unlink/list.

## Phase 3: Verification

- [x] 3.1 `bun run typecheck` — zero errors across all 23 workspace tasks
- [x] 3.2 Full test suite — no regression
- [x] 3.3 `opencode --help` no longer offers `hook`
- [x] 3.4 Re-run the sweep — no fork-owned unreferenced module remains
  - 16 unreferenced modules remain, all upstream, all listed in the proposal
- [x] 3.5 `opencode beads` runs end to end
