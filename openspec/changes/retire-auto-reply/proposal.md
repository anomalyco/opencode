# Retire the non-functional auto-reply feature

## Why

`auto-reply` is scaffolding with a CLI surface and no implementation behind it. It is
advertised as working in three places and cannot work at all.

Evidence:

- **Never registered in the layer graph.** Live services export a `LayerNode` `node` and
  appear in the node list in `server/routes/instance/httpapi/server.ts` (~:215-265) —
  e.g. `Loop.node` at `server.ts:248`, defined at `loop.ts:451`.
  `auto-reply/auto-reply.ts` exports only `layer`/`defaultLayer` (:81-82), never imports
  `LayerNode`, and appears nowhere in `server.ts`. No long-lived process holds an instance.
  The same is true of `automation-features.ts:103`, `pattern-detection.ts:81`, and
  `scheduler.ts:81`.
- **No call site in the turn loop.** A repo-wide search for
  `AutoReply|autoReply|shouldAutoReply|generateReply` hits exactly four source files —
  the service, its CLI command, the `automation-features` facade, and the command
  registration — plus two tests (`test/automation.test.ts`,
  `test/integration/automation-integration.test.ts`). Nothing in
  `packages/opencode/src/session/` references it. `AutomationFeatures.Service` has zero
  consumers outside its own file and those tests.
- **`--status` is structurally broken.** `cli/cmd/auto-reply.ts:71` does
  `.pipe(Effect.provide(AutoReply.layer))`, building a fresh private instance per CLI
  invocation. `--enable` mutates an in-memory `Ref` (`auto-reply.ts:45-46`) that is
  garbage-collected on exit; `--status` constructs *another* fresh layer and therefore
  always prints `disabled`.
- **Config is not in the schema and never persisted.** `AutoReplyConfig` is a plain TS
  interface (`auto-reply.ts:3-10`) with hardcoded defaults (:25-42). Searching
  `config/config.ts` for `autoReply|automation|loop` returns zero matches.
  `AUTOMATION_FEATURES.md:173` claims settings live in `~/.opencode/auto-reply.json` —
  no code reads or writes that path.
- **Docs promise a working feature.** `AUTOMATION_FEATURES.md:68-84,173`,
  `CHANGELOG.md:37`, and `skein.json:59-60` all describe it as available. The CLI
  describe string (`cli/cmd/auto-reply.ts:8`) reads "enable or disable automatic replies
  when the LLM pauses for input" — a promise nothing implements.

All of it landed in one commit (`6b9e4a6788`) and was never touched again.

Fixing the wiring would not make it work: there is still no call site in the turn loop
and no persisted config. It would be a new subsystem, and it would duplicate `/loop` —
which is the same idea (keep the model working without human turns) with a real
implementation, a server-side service, an HTTP API, TUI commands, and tests.

Keeping a command that reports success and does nothing is worse than not having it. It
cost real debugging time to establish that it is inert.

## What Changes

- Delete `packages/opencode/src/auto-reply/`.
- Delete `packages/opencode/src/automation/` and
  `packages/opencode/src/pattern-detection.ts` if the same audit shows they are
  likewise unreferenced outside tests. **Verify before deleting** — `pattern-detection`
  is adjacent to the sub-agent loop detection landed in `27397975eb` and may have a live
  consumer that the auto-reply audit did not cover.
- Delete `packages/opencode/src/cli/cmd/auto-reply.ts` and its registration in
  `fork/commands.ts:3,25`.
- Delete the two dead test files.
- Remove the false claims from `AUTOMATION_FEATURES.md`, `CHANGELOG.md`, and
  `skein.json`. Where the docs describe the *intent*, point the reader at `/loop`.
- Add a `CHANGELOG` entry recording the removal, so anyone who read the old docs learns
  where it went.

`opencode auto-reply` becomes an unknown command. That is a behaviour change only in the
sense that a command which never had an effect stops existing.

## Capabilities

### Removed Capabilities
- `auto-reply`: never functional; superseded by `loop-service`.

## Non-Goals

- Not reimplementing auto-reply under another name. `/loop` is the supported path, and
  `loop-spec-queue` extends it to unattended multi-change work.
- Not touching the sub-agent loop detection from `27397975eb`, which is live and
  unrelated.
- Not removing `scheduler.ts` in this change unless the audit shows it is also inert —
  scheduling is a distinct concern and deserves its own decision.

## Impact

- Deleted: `packages/opencode/src/auto-reply/`, `packages/opencode/src/cli/cmd/auto-reply.ts`,
  `packages/opencode/test/automation.test.ts`,
  `packages/opencode/test/integration/automation-integration.test.ts`, and — pending the
  audit — `packages/opencode/src/automation/`, `packages/opencode/src/pattern-detection.ts`.
- Modified: `packages/opencode/src/fork/commands.ts`,
  `packages/opencode/AUTOMATION_FEATURES.md`, `CHANGELOG.md`, `skein.json`.
- No runtime behaviour changes for any working feature — nothing calls the removed code.
