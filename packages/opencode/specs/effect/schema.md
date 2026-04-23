# Schema migration

Practical reference for migrating data types in `packages/opencode` from
Zod-first definitions to Effect Schema with Zod compatibility shims.

## Goal

Use Effect Schema as the source of truth for domain models, IDs, inputs,
outputs, and typed errors. Keep Zod available at existing HTTP, tool, and
compatibility boundaries by exposing a `.zod` static derived from the Effect
schema via `@/util/effect-zod`.

The long-term driver is `specs/effect/http-api.md` — once the HTTP server
moves to `@effect/platform`, every Schema-first DTO can flow through
`HttpApi` / `HttpRouter` without a zod translation layer, and the entire
`effect-zod` walker plus every `.zod` static can be deleted.

## Preferred shapes

### Data objects

Use `Schema.Class` for structured data.

```ts
export class Info extends Schema.Class<Info>("Foo.Info")({
  id: FooID,
  name: Schema.String,
  enabled: Schema.Boolean,
}) {
  static readonly zod = zod(Info)
}
```

If the class cannot reference itself cleanly during initialization, use the
two-step `withStatics` pattern:

```ts
export const Info = Schema.Struct({
  id: FooID,
  name: Schema.String,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
```

### Errors

Use `Schema.TaggedErrorClass` for domain errors.

```ts
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("FooNotFoundError", {
  id: FooID,
}) {}
```

### IDs and branded leaf types

Keep branded/schema-backed IDs as Effect schemas and expose
`static readonly zod` for compatibility when callers still expect Zod.

### Refinements

Reuse named refinements instead of re-spelling `z.number().int().positive()`
in every schema. The `effect-zod` walker translates the Effect versions into
the corresponding zod methods, so JSON Schema output (`type: integer`,
`exclusiveMinimum`, `pattern`, `format: uuid`, …) is preserved.

```ts
const PositiveInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))
const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))
```

See `test/util/effect-zod.test.ts` for the full set of translated checks.

## Compatibility rule

During migration, route validators, tool parameters, and any existing
Zod-based boundary should consume the derived `.zod` schema instead of
maintaining a second hand-written Zod schema.

The default should be:

- Effect Schema owns the type
- `.zod` exists only as a compatibility surface
- new domain models should not start Zod-first unless there is a concrete
  boundary-specific need

## When Zod can stay

It is fine to keep a Zod-native schema temporarily when:

- the type is only used at an HTTP or tool boundary and is not reused elsewhere
- the validator depends on Zod-only transforms or behavior not yet covered by `zod()`
- the migration would force unrelated churn across a large call graph

When this happens, prefer leaving a short note or TODO rather than silently
creating a parallel schema source of truth.

## Escape hatches

The walker in `@/util/effect-zod` exposes two explicit escape hatches for
cases the pure-Schema path cannot express. Each one stays in the codebase
only as long as its upstream or local dependency requires it — inline
comments document when each can be deleted.

### `ZodOverride` annotation

Replaces the entire derivation with a hand-crafted zod schema. Used when:

- the target carries external `$ref` metadata (e.g.
  `config/model-id.ts` points at `https://models.dev/...`)
- the target is a zod-only schema that cannot yet be expressed as Schema
  (e.g. `ConfigAgent.Info`, `Log.Level`)

### Local `DeepMutable<T>` in `config/config.ts`

`Schema.Struct` produces `readonly` types. Some consumer code (notably the
`Config` service) mutates `Info` objects directly, so a readonly-stripping
utility is needed when casting the derived zod schema's output type.

`Types.DeepMutable` from effect-smol would be a drop-in, but it widens
`unknown` to `{}` in the fallback branch — a bug that affects any schema
using `Schema.Record(String, Schema.Unknown)`.

Tracked upstream as `effect:core/x228my`: "Types.DeepMutable widens unknown
to `{}`." Once that lands, the local `DeepMutable` copy can be deleted and
`Types.DeepMutable` used directly.

## Ordering

Migrate in this order:

1. Shared leaf models and `schema.ts` files
2. Exported `Info`, `Input`, `Output`, and DTO types
3. Tagged domain errors
4. Service-local internal models
5. Route and tool boundary validators that can switch to `.zod`

This keeps shared types canonical first and makes boundary updates mostly
mechanical.

## Progress tracker

### `src/config/` ✅ complete

All of `packages/opencode/src/config/` has been migrated. Files that still
import `z` do so only for local `ZodOverride` bridges or for `z.ZodType`
type annotations — the `export const <Info|Spec>` values are all Effect
Schema at source.

- [x] skills, formatter, console-state, mcp, lsp, permission (leaves), model-id, command, plugin, provider
- [x] server, layout
- [x] keybinds
- [x] permission#Info
- [x] agent
- [x] config.ts root

### `src/*/schema.ts` leaf modules

These are the highest-priority next targets. Each is a small, self-contained
schema module with a clear domain.

- [x] `src/control-plane/schema.ts`
- [x] `src/permission/schema.ts`
- [x] `src/project/schema.ts`
- [x] `src/provider/schema.ts`
- [x] `src/pty/schema.ts`
- [x] `src/question/schema.ts`
- [x] `src/session/schema.ts`
- [x] `src/sync/schema.ts`
- [x] `src/tool/schema.ts`

### Session domain

Major cluster. Message + event types flow through the SSE API and every SDK
output, so byte-identical SDK surface is critical.

Suggested order for this cluster, starting from the leaves that `session.ts`
and the SSE/event surface depend on:

1. `src/session/schema.ts` ✅ already migrated
2. `src/provider/schema.ts` if `message-v2.ts` still relies on zod-first IDs
3. `src/lsp/*` schema leaves needed by `LSP.Range`
4. `src/snapshot/*` leaves used by `Snapshot.FileDiff`
5. `src/session/message-v2.ts`
6. `src/session/message.ts`
7. `src/session/prompt.ts`
8. `src/session/revert.ts`
9. `src/session/summary.ts`
10. `src/session/status.ts`
11. `src/session/todo.ts`
12. `src/session/session.ts`
13. `src/session/compaction.ts`

Dependency sketch:

```text
session.ts
|- project/schema.ts
|- control-plane/schema.ts
|- permission/schema.ts
|- snapshot/*
|- message-v2.ts
|  |- provider/schema.ts
|  |- lsp/*
|  |- snapshot/*
|  |- sync/index.ts
|  `- bus/bus-event.ts
|- sync/index.ts
|- bus/bus-event.ts
`- util/update-schema.ts
```

Working rule for this cluster:

- migrate reusable leaf schemas and nested payload objects first
- migrate aggregate DTOs like `Session.Info` after their nested pieces exist as
  named Schema values
- leave zod-only event/update helpers in place temporarily when converting
  them would force unrelated churn across sync/bus boundaries

`message-v2.ts` first-pass outline:

1. Schema-backed imports already available
   - `SessionID`, `MessageID`, `PartID`
   - `ProviderID`, `ModelID`
2. Local leaf objects to extract and migrate first
   - output format payloads
   - common part bases like `PartBase`
   - timestamp/range helper objects like `time.start/end`
   - file/source helper objects
   - token/cost/model helper objects
3. Part variants built from those leaves
   - `SnapshotPart`, `PatchPart`, `TextPart`, `ReasoningPart`
   - `FilePart`, `AgentPart`, `CompactionPart`, `SubtaskPart`
   - retry/step/tool related parts
4. Higher-level unions and DTOs
   - `FilePartSource`
   - part unions
   - message unions and assistant/user payloads
5. Errors and event payloads last
   - `NamedError.create(...)` shapes can stay temporarily if converting them to
     `Schema.TaggedErrorClass` would force unrelated churn
   - `SyncEvent.define(...)` and `BusEvent.define(...)` payloads can keep using
     derived `.zod` until the sync/bus layers are migrated

Possible later tightening after the Schema-first migration is stable:

- promote repeated opaque strings and timestamp numbers into branded/newtype
  leaf schemas where that adds domain value without changing the wire format

- [ ] `src/session/compaction.ts`
- [ ] `src/session/message-v2.ts`
- [ ] `src/session/message.ts`
- [ ] `src/session/prompt.ts`
- [ ] `src/session/revert.ts`
- [ ] `src/session/session.ts`
- [ ] `src/session/status.ts`
- [ ] `src/session/summary.ts`
- [ ] `src/session/todo.ts`

### Provider domain

- [ ] `src/provider/auth.ts`
- [ ] `src/provider/models.ts`
- [ ] `src/provider/provider.ts`

### Tool schemas

Each tool declares its parameters via a zod schema. Tools are consumed by
both the in-process runtime and the AI SDK's tool-calling layer, so the
emitted JSON Schema must stay byte-identical.

- [ ] `src/tool/apply_patch.ts`
- [ ] `src/tool/bash.ts`
- [ ] `src/tool/codesearch.ts`
- [ ] `src/tool/edit.ts`
- [ ] `src/tool/glob.ts`
- [ ] `src/tool/grep.ts`
- [ ] `src/tool/invalid.ts`
- [ ] `src/tool/lsp.ts`
- [ ] `src/tool/plan.ts`
- [ ] `src/tool/question.ts`
- [ ] `src/tool/read.ts`
- [ ] `src/tool/registry.ts`
- [ ] `src/tool/skill.ts`
- [ ] `src/tool/task.ts`
- [ ] `src/tool/todo.ts`
- [ ] `src/tool/tool.ts`
- [ ] `src/tool/webfetch.ts`
- [ ] `src/tool/websearch.ts`
- [ ] `src/tool/write.ts`

### HTTP route boundaries

Every file in `src/server/routes/` uses hono-openapi with zod validators for
route inputs/outputs. Migrating these individually is the last step; most
will switch to `.zod` derived from the Schema-migrated domain types above,
which means touching them is largely mechanical once the domain side is
done.

- [ ] `src/server/error.ts`
- [ ] `src/server/event.ts`
- [ ] `src/server/projectors.ts`
- [ ] `src/server/routes/control/index.ts`
- [ ] `src/server/routes/control/workspace.ts`
- [ ] `src/server/routes/global.ts`
- [ ] `src/server/routes/instance/index.ts`
- [ ] `src/server/routes/instance/config.ts`
- [ ] `src/server/routes/instance/event.ts`
- [ ] `src/server/routes/instance/experimental.ts`
- [ ] `src/server/routes/instance/file.ts`
- [ ] `src/server/routes/instance/mcp.ts`
- [ ] `src/server/routes/instance/permission.ts`
- [ ] `src/server/routes/instance/project.ts`
- [ ] `src/server/routes/instance/provider.ts`
- [ ] `src/server/routes/instance/pty.ts`
- [ ] `src/server/routes/instance/question.ts`
- [ ] `src/server/routes/instance/session.ts`
- [ ] `src/server/routes/instance/sync.ts`
- [ ] `src/server/routes/instance/tui.ts`

The bigger prize for this group is the `@effect/platform` HTTP migration
described in `specs/effect/http-api.md`. Once that lands, every one of
these files changes shape entirely (`HttpApi.endpoint(...)` and friends),
so the Schema-first domain types become a prerequisite rather than a
sibling task.

### Everything else

Small / shared / control-plane / CLI. Mostly independent; can be done
piecewise.

- [ ] `src/acp/agent.ts`
- [ ] `src/agent/agent.ts`
- [ ] `src/bus/bus-event.ts`
- [ ] `src/bus/index.ts`
- [ ] `src/cli/cmd/tui/config/tui-migrate.ts`
- [ ] `src/cli/cmd/tui/config/tui-schema.ts`
- [ ] `src/cli/cmd/tui/config/tui.ts`
- [ ] `src/cli/cmd/tui/event.ts`
- [ ] `src/cli/ui.ts`
- [ ] `src/command/index.ts`
- [ ] `src/control-plane/adaptors/worktree.ts`
- [ ] `src/control-plane/types.ts`
- [ ] `src/control-plane/workspace.ts`
- [ ] `src/file/index.ts`
- [ ] `src/file/ripgrep.ts`
- [ ] `src/file/watcher.ts`
- [ ] `src/format/index.ts`
- [ ] `src/id/id.ts`
- [ ] `src/ide/index.ts`
- [ ] `src/installation/index.ts`
- [ ] `src/lsp/client.ts`
- [ ] `src/lsp/lsp.ts`
- [ ] `src/mcp/auth.ts`
- [ ] `src/patch/index.ts`
- [ ] `src/plugin/github-copilot/models.ts`
- [ ] `src/project/project.ts`
- [ ] `src/project/vcs.ts`
- [ ] `src/pty/index.ts`
- [ ] `src/skill/index.ts`
- [ ] `src/snapshot/index.ts`
- [ ] `src/storage/db.ts`
- [ ] `src/storage/storage.ts`
- [ ] `src/sync/index.ts`
- [ ] `src/util/fn.ts`
- [ ] `src/util/log.ts`
- [ ] `src/util/update-schema.ts`
- [ ] `src/worktree/index.ts`

### Do-not-migrate

- `src/util/effect-zod.ts` — the walker itself. Stays zod-importing forever
  (it's what emits zod from Schema). Goes away only when the `.zod`
  compatibility layer is no longer needed anywhere.

## Notes

- Use `@/util/effect-zod` for all Schema → Zod conversion.
- Prefer one canonical schema definition. Avoid maintaining parallel Zod and
  Effect definitions for the same domain type.
- Keep the migration incremental. Converting the domain model first is more
  valuable than converting every boundary in the same change.
- Every migrated file should leave the generated SDK output (`packages/sdk/
openapi.json` and `packages/sdk/js/src/v2/gen/types.gen.ts`) byte-identical
  unless the change is deliberately user-visible.
