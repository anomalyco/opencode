# Schema migration

Practical reference for migrating data types in `packages/opencode` from
Zod-first definitions to Effect Schema.

## Goal

Use Effect Schema as the source of truth for domain models, IDs, inputs,
outputs, and typed errors. Prefer native Effect Schema, Standard Schema, and
native JSON Schema generation at HTTP, tool, and AI SDK boundaries.

The long-term driver is `specs/effect/http-api.md`: Schema-first DTOs should
flow through `HttpApi` / `HttpRouter` without a Zod translation layer.

## Preferred shapes

### Data objects

Use `Schema.Class` for structured data.

```ts
export class Info extends Schema.Class<Info>("Foo.Info")({
  id: FooID,
  name: Schema.String,
  enabled: Schema.Boolean,
}) {}
```

If a schema needs local static helpers, use the two-step `withStatics` pattern:

```ts
export const Info = Schema.Struct({
  id: FooID,
  name: Schema.String,
}).pipe(withStatics((s) => ({ decode: Schema.decodeUnknownOption(s) })))
```

### Errors

Use `Schema.TaggedErrorClass` for domain errors.

```ts
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("FooNotFoundError", {
  id: FooID,
}) {}
```

### IDs and branded leaf types

Keep branded/schema-backed IDs as Effect schemas.

### Refinements

Reuse named refinements instead of re-spelling numeric or string constraints in
every schema. Boundary JSON Schema helpers should normalize native Effect JSON
Schema output only where a provider requires it.

```ts
const PositiveInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))
const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))
```

## Compatibility rule

During migration, route validators, tool parameters, and AI SDK schemas should
consume Effect schemas directly or use a narrow boundary helper. Avoid
maintaining a second hand-written Zod schema.

The default should be:

- Effect Schema owns the type
- new domain models should not start Zod-first unless there is a concrete
  boundary-specific need

## When Zod can stay

It is fine to keep a Zod-native schema temporarily when:

- the type is only used at an HTTP or tool boundary and is not reused elsewhere
- the validator is part of an existing public API that explicitly accepts Zod
- the migration would force unrelated churn across a large call graph

When this happens, prefer leaving a short note or TODO rather than silently
creating a parallel schema source of truth.

## Boundary helpers

Use narrow helpers at concrete boundaries instead of a generic Schema → Zod bridge.

- Tool parameters: `ToolJsonSchema.fromSchema(...)` and `ToolJsonSchema.fromTool(...)`
- Public config/TUI schemas: `packages/opencode/script/schema.ts`
- AI SDK object generation: `Schema.toStandardSchemaV1(...)` plus `Schema.toStandardJSONSchemaV1(...)`

Plugin tools are the main remaining intentional Zod boundary because the public
plugin API exposes `tool.schema = z` and `args: z.ZodRawShape`.

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
5. Route and tool boundary validators that can switch to native Effect Schema helpers

This keeps shared types canonical first and makes boundary updates mostly
mechanical.

## Progress tracker

### `src/config/` ✅ complete

All of `packages/opencode/src/config/` has been migrated. The `export const
<Info|Spec>` values are all Effect Schema at source.

A file is considered "done" when:

- its exported schema values (`Info`, `Input`, `Event`, `Definition`, etc.)
  are authored as Effect Schema
- any remaining Zod is an explicit boundary compatibility choice, not a
  hand-written parallel source of truth

Files that meet this bar but still carry a compatibility boundary are checked
off with an inline note describing the boundary and what unblocks its removal.

- [x] skills, formatter, console-state, mcp, lsp, permission (leaves), model-id, command, plugin, provider
- [x] server, layout
- [x] keybinds
- [x] permission#Info
- [x] agent
- [x] config.ts root

### `src/*/schema.ts` leaf modules

These are the highest-priority next targets. Each is a small, self-contained
schema module with a clear domain.

- [x] `src/account/schema.ts`
- [x] `src/control-plane/schema.ts`
- [x] `src/permission/schema.ts`
- [x] `src/project/schema.ts`
- [x] `src/provider/schema.ts`
- [x] `src/pty/schema.ts`
- [x] `src/question/schema.ts`
- [x] `src/session/schema.ts`
- [x] `src/storage/schema.ts`
- [x] `src/sync/schema.ts`
- [x] `src/tool/schema.ts`
- [x] `src/util/schema.ts`

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
   - `SyncEvent.define(...)` and `BusEvent.define(...)` payloads can use
     derived `.zod` at remaining zod-based HTTP/OpenAPI boundaries

Possible later tightening after the Schema-first migration is stable:

- promote repeated opaque strings and timestamp numbers into branded/newtype
  leaf schemas where that adds domain value without changing the wire format

- [x] `src/session/compaction.ts`
- [x] `src/session/message-v2.ts`
- [x] `src/session/message.ts`
- [x] `src/session/prompt.ts`
- [x] `src/session/revert.ts`
- [x] `src/session/session.ts`
- [x] `src/session/status.ts`
- [x] `src/session/summary.ts`
- [x] `src/session/todo.ts`

### Provider domain

- [x] `src/provider/auth.ts`
- [x] `src/provider/models.ts`
- [x] `src/provider/provider.ts`

### Tool schemas

Each tool declares its parameters via a zod schema. Tools are consumed by
both the in-process runtime and the AI SDK's tool-calling layer, so the
emitted JSON Schema must stay byte-identical.

- [x] `src/tool/apply_patch.ts`
- [x] `src/tool/bash.ts`
- [x] `src/tool/edit.ts`
- [x] `src/tool/glob.ts`
- [x] `src/tool/grep.ts`
- [x] `src/tool/invalid.ts`
- [x] `src/tool/lsp.ts`
- [x] `src/tool/plan.ts`
- [x] `src/tool/question.ts`
- [x] `src/tool/read.ts`
- [x] `src/tool/registry.ts`
- [x] `src/tool/skill.ts`
- [x] `src/tool/task.ts`
- [x] `src/tool/todo.ts`
- [x] `src/tool/tool.ts`
- [x] `src/tool/webfetch.ts`
- [x] `src/tool/websearch.ts`
- [x] `src/tool/write.ts`

### HTTP route boundaries

The server route tree now lives under `src/server/routes/instance/httpapi` and
uses Effect HttpApi contracts for request and response schemas. Remaining schema
work is no longer a Hono route migration; it is compatibility cleanup around
derived `.zod` statics, OpenAPI translation shims, and route groups that still
need explicit SDK-visible error contracts.

Good follow-up targets:

- shrink `public.ts` legacy OpenAPI translation shims one SDK-compatible slice at a time
- replace production `.zod.safeParse(...)` call sites with Effect Schema decoders
- remove derived `.zod` statics after their production consumers are gone
- declare route-group errors directly instead of relying on compatibility middleware

### Everything else

Small / shared / control-plane / CLI. Mostly independent; can be done
piecewise.

- [ ] `src/acp/agent.ts`
- [ ] `src/agent/agent.ts`
- [x] `src/bus/bus-event.ts`
- [ ] `src/bus/index.ts`
- [ ] `src/cli/cmd/tui/config/tui-migrate.ts`
- [ ] `src/cli/cmd/tui/config/tui-schema.ts`
- [ ] `src/cli/cmd/tui/config/tui.ts`
- [ ] `src/cli/cmd/tui/event.ts`
- [ ] `src/cli/ui.ts`
- [ ] `src/command/index.ts`
- [x] `src/control-plane/adapters/worktree.ts`
- [x] `src/control-plane/types.ts`
- [x] `src/control-plane/workspace.ts`
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
- [x] `src/sync/index.ts` — public API (`SyncEvent.define`) is Schema-first; `payloads()` still derives zod for the remaining HTTP/OpenAPI boundary
- [ ] `src/util/fn.ts`
- [ ] `src/util/log.ts`
- [ ] `src/util/update-schema.ts`
- [ ] `src/worktree/index.ts`

## Notes

- Prefer one canonical schema definition. Avoid maintaining parallel Zod and
  Effect definitions for the same domain type.
- Keep the migration incremental. Converting the domain model first is more
  valuable than converting every boundary in the same change.
- Every migrated file should leave the generated SDK output (`packages/sdk/
openapi.json` and `packages/sdk/js/src/v2/gen/types.gen.ts`) byte-identical
  unless the change is deliberately user-visible.
