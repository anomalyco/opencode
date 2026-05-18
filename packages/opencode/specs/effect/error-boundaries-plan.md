# Error Boundaries Plan

Plan for removing `NamedError` as connective tissue while keeping public
wire contracts stable.

## Desired Shape

```text
Domain/service error
  Schema.TaggedErrorClass
  - catchable with catchTag / catchTags
  - appears in service method error type
  - no HTTP status
  - no toObject()

HTTP public error
  Schema.ErrorClass / TaggedErrorClass with httpApiStatus
  - endpoint-declared public contract
  - owns legacy { name, data } only when that is the SDK wire shape

CLI/user rendering
  FormatError and small format helpers
  - converts domain errors to text
  - preserves useful structured fields

Session/model-visible error
  first-class session/message error schema or helper
  - owns { name, data } event/message shape
  - not a service error class
```

The important rule: a service error should not also be the HTTP body, CLI
formatter, and session event body. Each seam adapts the error into the
shape it owns.

## Concrete Example: Provider Model Not Found

Before:

```ts
export const ModelNotFoundError = NamedError.create("ProviderModelNotFoundError", {
  providerID: ProviderID,
  modelID: ModelID,
  suggestions: Schema.optional(Schema.Array(Schema.String)),
})
```

Problems:

- Throwing it inside `Effect.fn` made it behave like a defect unless a
  compatibility bridge caught it.
- HTTP middleware knew that this one domain error should be a `400`.
- Callers read `.data.*`, which couples them to the legacy `{ name, data }`
  wire shape.

After:

```ts
export class ModelNotFoundError extends Schema.TaggedErrorClass<ModelNotFoundError>()("ProviderModelNotFoundError", {
  providerID: ProviderID,
  modelID: ModelID,
  suggestions: Schema.optional(Schema.Array(Schema.String)),
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly getModel: (providerID: ProviderID, modelID: ModelID) => Effect.Effect<Model, ModelNotFoundError>
}
```

Boundary adapters:

```text
CLI
└─ FormatError sees _tag ProviderModelNotFoundError -> nice text

Session prompt
└─ catch ModelNotFoundError -> publish Session.Event.Error as message/session wire shape

HTTP route
└─ catch ModelNotFoundError -> declared BadRequest public API error when the endpoint needs it

HTTP middleware
└─ no Provider.ModelNotFoundError knowledge
```

## Refining Known Promise Failures

Use `EffectPromise.refineRejection(...)` when a Promise boundary can reject
with many unknown values, but only one or two rejection classes are expected
domain failures. Unknown rejections stay defects; the helper maps only known
rejection shapes to typed errors.

```ts
const language =
  yield *
  EffectPromise.refineRejection(
    async () => loadFromProvider(),
    (cause) => (cause instanceof NoSuchModelError ? new ModelNotFoundError({ providerID, modelID, cause }) : undefined),
  )
```

Use this when the Promise can genuinely reject and most rejection values are
still defects for the current module. Use `Effect.tryPromise({ try, catch })`
when every rejection should become the same expected error type. Use
`Effect.promise(...)` only when rejection means a defect and you do not need
to refine known rejection classes.

## Helper Modules We Probably Want

Add helpers only when repeated call sites prove the seam is real.

### HTTP API Errors

Likely location: `src/server/routes/instance/httpapi/errors.ts`.

Purpose:

- construct public HTTP error bodies
- preserve legacy `{ name, data }` where needed
- attach `httpApiStatus`

Good helpers:

```ts
notFound(message)
badRequest(message)
unknown()
```

Avoid:

```ts
mapAnyDomainError(error)
```

That recreates the giant middleware mapper problem.

### Session / Message Error Wire Helpers

Likely location: near `src/session/message-error.ts` or a new narrow
module such as `src/session/event-error.ts`.

Purpose:

- construct the `{ name, data }` shape used by `Session.Event.Error` and
  assistant message errors
- replace `new NamedError.Unknown(...).toObject()` call sites
- keep model-visible error bodies separate from service/domain errors

Good helpers:

```ts
unknown(message)
agentNotFound(agent, available)
commandNotFound(command, available)
modelNotFound(error: Provider.ModelNotFoundError)
```

### CLI Formatters

Likely location: `src/cli/error.ts` until repetition demands domain-local
format helpers.

Purpose:

- produce human-readable terminal messages from typed errors
- support old `{ name, data }` shapes only while compatibility is needed

## Migration Queue

### Remove Domain Knowledge From HTTP Middleware

- [x] Storage not found no longer maps through defect fallback.
- [x] Worktree expected errors moved to typed errors.
- [x] Provider auth expected errors moved to typed errors.
- [x] Provider model not found no longer needs an HTTP middleware status
      special case.
- [ ] Convert `Session.BusyError` and map it at route boundaries.
- [ ] Delete the broad `NamedError` middleware branch once no route relies
      on defect-wrapped legacy domain errors.
- [ ] Keep one final unknown-defect fallback that logs `Cause.pretty(cause)`
      and returns a safe `500` body.

### Remaining `NamedError.create(...)` Service Errors

These should become `Schema.TaggedErrorClass` when touched:

- [ ] `src/provider/provider.ts` — `ProviderInitError`.
- [ ] `src/storage/db.ts` — database `NotFoundError`.
- [ ] `src/mcp/index.ts` — `MCPFailed`.
- [ ] `src/skill/index.ts` — `SkillInvalidError`,
      `SkillNameMismatchError`.
- [ ] `src/lsp/client.ts` — `LSPInitializeError`.
- [ ] `src/ide/index.ts` — install errors.
- [ ] `src/config/error.ts`, `src/config/config.ts`,
      `src/config/markdown.ts` — config errors. These already render well
      in the CLI, so migrate carefully and preserve diagnostics.

### Session / Message Wire Errors

These are not ordinary service errors. They mostly build `{ name, data }`
objects for model-visible/session-visible output.

- [ ] Add a first-class session/message error wire helper.
- [ ] Replace `new NamedError.Unknown(...).toObject()` in
      `src/session/prompt.ts`.
- [ ] Replace `new NamedError.Unknown(...).toObject()` in config/skill/plugin
      session event publishing.
- [ ] Move `src/session/message-error.ts` and `src/session/message-v2.ts`
      away from `NamedError.create(...)` once the wire helper exists.
- [ ] Update retry/message tests to assert the wire schema/helper output,
      not `NamedError` instances.

### CLI Rendering

- [x] Tagged config errors render with useful diagnostics.
- [x] Provider model not found renders from both old `{ name, data }` and
      new `_tag` shapes.
- [ ] Add typed render cases as more `NamedError.create(...)` domains move
      to `Schema.TaggedErrorClass`.
- [ ] Eventually remove old-shape compatibility branches when no callers can
      produce them.

## PR Checklist

For each migrated error:

- [ ] Domain error is `Schema.TaggedErrorClass`.
- [ ] Service method exposes the typed error in its error channel.
- [ ] No service error has `toObject()` just for compatibility.
- [ ] CLI, HTTP, and session/message adapters each own their output shape.
- [ ] HTTP middleware gets smaller or stays unchanged.
- [ ] Focused tests cover the domain error and any public rendering/wire
      shape touched by the PR.
