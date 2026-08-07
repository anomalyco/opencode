# Sweep the remaining fork-owned code that does nothing

## Why

`retire-auto-reply` deleted three modules that were advertised as working and never were.
That was found by accident, from a stray stash. The obvious question is what else is like
that, and the answer should come from a sweep rather than from the next accident.

Two categories, and the second is worse than the first:

**Dead files** — no importer, not in the layer graph, nothing reaches them. Harmless except
that every reader has to work out they are inert, and every refactor drags them along.

**Live commands that lie** — registered, reachable, and doing nothing while reporting
success. `opencode pattern-detection --enable` printed "pattern detection enabled" and
configured a service instance that died with the process. That is not dead code; it is a
false statement the CLI makes to the user, and it is the category worth hunting.

## What Changes

A scan of every module under `packages/*/src` for inbound references, cross-checked against
`upstream/dev` to separate fork-owned code from upstream's, produced 14 unreferenced files.
Eleven are upstream. Three are ours. One live command was found lying.

### Deleted — fork-owned and inert

| file | why |
| --- | --- |
| `opencode/src/scheduler/scheduler.ts` | Service with no importer, absent from the node list. The third member of the auto-reply/automation/pattern-detection group; `retire-auto-reply` task 1.3 recorded it and deferred it here. |
| `opencode/src/session/event-error.ts` | Error-factory module, no importer. Not related to `ProviderShared.eventError` in `packages/llm`, which is live and unaffected. |
| `tui/src/util/auto-mode.ts` | The `manual / skip-ask / continue / auto` mode ladder, orphaned when that UI was removed. Nothing imports it. |

### Deleted — a command that reports success for nothing

`opencode hook` prints *"hooks are configured in your opencode config file under the
'hooks' key"*. **There is no `hooks` key in the config schema.** Plugin-provided hooks
exist, and they are configured under `plugin`. So a command described as "manage opencode
hooks" manages nothing and directs the reader to a key that does not exist.

Same shape as `pattern-detection --enable`: registered, reachable, wrong.

### Registered, not deleted — the opposite finding

`opencode beads` did not exist. `cli/cmd/beads.ts` exports `BeadsCommand` — 194 lines of
working code over the live `BeadsSync` service, with `status`, `sync`, `unlink` and `list`
— and nothing ever imported it. Not in `ForkCommands`, not in `index.ts`. Unreachable.

It is now registered. Unreferenced and useless are different findings and lead to opposite
actions: `hook` was reachable and did nothing, so it goes; this does something real and was
not reachable, so it gets connected. Deleting it to satisfy a tidiness rule would have
destroyed working code.

Found by noticing `beads` missing from `--help`, not by the scan — the scan's file-reference
check saw the live `beads/` service directory and counted the name as referenced. A false
negative worth knowing about alongside the false positives below.

### Deliberately NOT deleted — eleven upstream files

`core/src/data-migration.sql.ts`, `core/src/plugin/layer-map.example.ts`,
`opencode/src/cli/cmd/github.handler.ts`, `opencode/src/control-plane/dev/debug-workspace-plugin.ts`,
`opencode/src/effect/bootstrap-runtime.ts`, `opencode/src/temporary.ts`,
`opencode/src/util/defer.ts`, `tui/src/component/dialog-tag.tsx`,
`tui/src/component/prompt/cwd.ts`, `tui/src/routes/session/dialog-subagent.tsx`,
`tui/src/routes/session/subagent-footer.tsx`.

All exist on `upstream/dev`. Deleting an upstream file buys nothing and costs a conflict on
every sync, forever. Whether they are dead is upstream's business.

### A false-positive class worth recording

The scan first flagged five more: `sqlite.bun.ts`, `sqlite.node.ts`, `pty.bun.ts`,
`pty.node.ts`, `fff.node.ts`. All five are live, resolved through `core/package.json`'s
`imports` field (`#sqlite`, `#pty`, `#fff`) by runtime condition. No import specifier names
them, so any "find unimported files" scan will condemn them. **A dead-code sweep that does
not check `imports`/`exports` conditions will delete the database layer.**

## Impact

- Four fewer fork-owned files; `opencode hook` disappears from `--help`.
- No behaviour change anywhere else — nothing referenced any of it.
- The scan method is recorded in `tasks.md` so this is repeatable rather than another
  accident.
