# V2 Plugin System Implementation Plan

## Status

This document describes the agreed target design for the V2 plugin system. It is an implementation plan, not documentation for the current API.

## Goals

- Internal and external plugins use the same public plugin API.
- Effect plugins import `@opencode-ai/plugin/v2/effect`, not `@opencode-ai/core`.
- Public domain values use generated `@opencode-ai/sdk` types.
- Core may retain branded IDs, decoded Effect schemas, and internal service types.
- Plugins may register replayable domain transforms and runtime hooks imperatively during setup.
- Registrations are scoped, independently disposable, ordered, and removable.
- Dynamic sources such as models.dev, config files, and skill directories can rebuild one domain without reloading the entire Location.
- The initial implementation covers the Effect API. A Promise API will be designed afterward as a wrapper over the same capabilities.

## Authoring Model

A plugin setup effect receives `PluginHost` and imperatively registers transforms and hooks.

```ts
export const Plugin = define({
  id: "example",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.agent.transform(
        Effect.fn(function* (agent) {
          agent.update("reviewer", (item) => {
            item.description = "Reviews code for regressions"
            item.mode = "subagent"
          })
        }),
      )

      yield* ctx.tool.hook(
        "execute.before",
        Effect.fn(function* (event) {
          event.args.update(sanitizeArgs)
        }),
      )
    }),
})
```

Plugin setup does not return hooks.

## Public Naming

Settled names:

- Replayable domain registration: `transform`
- Explicit domain replay: `rebuild`
- Runtime callback registration: `hook`
- Registration cleanup: `dispose`
- Event domain: singular `event`
- Other domains are singular: `agent`, `command`, `integration`, `reference`, `session`, `skill`, and `tool`; `catalog` remains `catalog`
- Hook names use dotted lifecycle names such as `"execute.before"` and `"execute.after"`

## Transform API

Each transformable domain exposes:

```ts
interface TransformDomain<Editor> {
  transform(callback: (editor: Editor) => Effect.Effect<void>): Effect.Effect<Registration, never, Scope.Scope>

  rebuild(): Effect.Effect<void>
}
```

The actual callback may be represented with the project's normal `Effect.fn` style.

```ts
const registration =
  yield *
  ctx.catalog.transform(
    Effect.fn(function* (catalog) {
      const integration = yield* ctx.integration.get("anthropic")
      if (!integration) return

      catalog.provider.update("anthropic", (provider) => {
        provider.name = "Anthropic"
      })
    }),
  )
```

Transforms may perform arbitrary Effects, including reads from other PluginHost services, filesystem I/O, and network I/O. Reads from another domain observe that domain's latest committed state.

Transforms have no typed error channel. Unexpected failures are defects.

## Transform Semantics

- Every call to `transform()` creates an independent registration.
- Multiple transforms from one plugin and domain are allowed.
- Transform order is plugin registration order, then transform registration order within the plugin.
- A transform is automatically removed when its registration scope closes.
- `Registration.dispose` removes it early and is idempotent.
- Registering or disposing a transform automatically rebuilds its domain.
- During bulk plugin boot, automatic rebuilds are deferred and each affected domain is rebuilt once after the batch.
- `rebuild()` waits until replay and finalization complete.
- `rebuild()` always replays every active transform for the domain.
- Rebuilds are serialized and coalesced. Calls arriving during an active rebuild schedule at most one additional rebuild.
- A rebuild captures its registration list at the start. Concurrent registration changes affect the next rebuild.
- Transforms may not register or dispose transforms while replaying. Such changes are rejected or deferred by the runtime.
- Calling `rebuild()` for the currently rebuilding domain from one of its transforms is rejected.
- Rebuilding another domain from a transform is deferred until the current transform finishes.

## Registration API

Transforms and runtime hooks return the same Effect registration type.

```ts
interface Registration {
  readonly dispose: Effect.Effect<void>
}
```

Registration behavior:

- Automatically attached to the current `Scope.Scope`
- Explicitly disposable before scope closure
- Disposal affects future replays or invocations
- An in-flight rebuild or hook invocation uses the registration snapshot captured when it started and is allowed to finish

## Runtime Hook API

Domains expose runtime interception through `hook()`.

```ts
const registration =
  yield *
  ctx.tool.hook(
    "execute.before",
    Effect.fn(function* (event) {
      event.args.update(sanitizeArgs)
    }),
  )
```

Runtime hook behavior:

- Multiple registrations for the same hook are allowed.
- Hooks run sequentially in plugin and registration order.
- Later hooks observe mutations made by earlier hooks.
- Hook registration is scope-owned and independently disposable.
- Disposal affects future invocations; an in-flight invocation finishes using its captured registration snapshot.
- Runtime hooks are not replayed during domain rebuilds.
- Runtime hook callbacks have no typed error channel.

## Hook Contexts

Each hook receives one purpose-built context object rather than separate input/output parameters.

```ts
ctx.tool.hook("execute.before", (event) => {
  event.args.update((args) => ({
    ...args,
    timeout: 30,
  }))
})
```

Hook context objects may contain:

- Readonly SDK-typed operation data
- Purpose-built methods for allowed mutations
- Capability methods where the operation requires more than field assignment

They must not expose core drafts or unrestricted internal objects.

## Domain Transforms Versus Runtime Hooks

Both use the same low-level scoped registration registry, but consumers invoke them differently.

```ts
ctx.tool.transform(...) // replayed to build effective tool registry state
ctx.tool.hook(...)      // invoked at a live tool operation boundary
```

The shared low-level machinery owns registration order, scope cleanup, disposal, and snapshots. Each domain owns when its transforms or runtime hooks execute.

## Event API

The Effect API exposes the existing event system as typed streams using generated SDK event discriminants.

```ts
ctx.event.subscribe("catalog.updated")
// Stream.Stream<EventCatalogUpdated>
```

Example:

```ts
yield *
  ctx.event.subscribe("catalog.updated").pipe(
    Stream.runForEach(() => ctx.agent.rebuild()),
    Effect.forkScoped,
  )
```

The plugin package derives event payload types from the generated SDK `Event` union:

```ts
type EventMap = {
  [Item in Event as Item["type"]]: Item
}
```

Core resolves the public event type string to its internal event definition and delegates to `EventV2.Service.subscribe`.

## Domain State Model

Each transformable core service continues to own:

- Base state
- Effective committed state
- Editor creation
- Ordered transform registrations for that domain
- Rebuild serialization and coalescing
- Core finalization
- Commit and post-commit events

The initial implementation should evolve the existing generic `State` helper rather than create a central cross-domain state manager.

```text
base state
→ replay active transforms in order
→ core domain finalization
→ commit effective state
→ publish updated event
```

No cross-domain transform or transaction API is included.

## Finalization

Each domain has one plugin transform phase followed by core finalization.

Core finalization is for invariants and materialization, not plugin extension behavior.

Examples:

- Catalog policy filtering and validation
- Reference repository materialization
- Integration connection projection
- Index construction
- Post-commit update events

Finalizers should distinguish pre-commit work from post-commit notification. Update events should publish after the new state is visible.

## Plugin Order

The default distribution uses an opinionated internal order:

```text
1. Built-in agents, commands, and skills
2. Base data sources such as models.dev
3. Configuration projections
4. Provider-specific normalization and authentication
5. External user plugins
6. Core domain finalization
```

For catalog transforms:

```text
models.dev
→ config provider overrides
→ built-in provider normalization
→ user catalog transforms
→ catalog finalization
```

This replaces the current distinction between setup-installed State transforms and catalog hooks invoked from the catalog finalizer.

Replacing a plugin with the same ID retains its existing order position. The old plugin is disabled before the replacement setup starts.

## Boot Batching

Plugin boot runs in an internal registration batch.

```text
begin batch
→ initialize plugins sequentially
→ register transforms and hooks
→ collect affected domains
→ rebuild each affected domain once
→ end batch
```

Registration itself is not staged per plugin. If setup fails, closing the plugin's child scope removes every registration made before the failure.

Outside a batch, transform registration and disposal rebuild immediately.

## Models.dev Example

Models.dev performs effectful reads directly from its transforms and rebuilds affected domains after refresh.

```ts
export const ModelsDevPlugin = define({
  id: "models-dev",
  effect: (ctx) =>
    Effect.gen(function* () {
      const modelsDev = yield* ModelsDev.Service
      const event = yield* EventV2.Service

      yield* ctx.integration.transform(
        Effect.fn(function* (integration) {
          const data = yield* modelsDev.get()
          applyIntegrations(data, integration)
        }),
      )

      yield* ctx.catalog.transform(
        Effect.fn(function* (catalog) {
          const data = yield* modelsDev.get()
          applyCatalog(data, catalog)
        }),
      )

      yield* event.subscribe(ModelsDev.Event.Refreshed).pipe(
        Stream.runForEach(
          Effect.fn(function* () {
            yield* ctx.integration.rebuild()
            yield* ctx.catalog.rebuild()
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
    }),
})
```

The two domains rebuild sequentially. This plan does not add a cross-domain atomic transaction.

## Config Watcher Example

```ts
export const ConfigPlugin = define({
  id: "config",
  effect: (ctx) =>
    Effect.gen(function* () {
      const config = yield* ConfigSource.Service

      yield* ctx.agent.transform(
        Effect.fn(function* (agent) {
          applyAgentConfig(yield* config.get(), agent)
        }),
      )

      yield* ctx.command.transform(
        Effect.fn(function* (command) {
          applyCommandConfig(yield* config.get(), command)
        }),
      )

      yield* config.changes.pipe(
        Stream.runForEach(
          Effect.fn(function* () {
            yield* ctx.agent.rebuild()
            yield* ctx.command.rebuild()
          }),
        ),
        Effect.forkScoped,
      )
    }),
})
```

## Cross-Domain Read Example

A transform may read another committed service. It must still arrange for its own domain to rebuild when that dependency changes.

```ts
export const AnthropicAgentPlugin = define({
  id: "anthropic-agent",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.agent.transform(
        Effect.fn(function* (agent) {
          const providers = yield* ctx.catalog.provider.list()
          if (!providers.some((provider) => provider.id === "anthropic")) return

          agent.update("anthropic-reviewer", (item) => {
            item.description = "Reviews code using Anthropic"
            item.mode = "subagent"
            item.model = {
              providerID: "anthropic",
              id: "claude-sonnet",
            }
          })
        }),
      )

      yield* ctx.event.subscribe("catalog.updated").pipe(
        Stream.runForEach(() => ctx.agent.rebuild()),
        Effect.forkScoped,
      )
    }),
})
```

The runtime does not infer cross-domain dependencies.

## Embedding API Compatibility

The imperative registration model maps naturally to a future application embedding API:

```ts
const registration = oc.agent.transform((agent) => {
  agent.update("reviewer", configureReviewer)
})

registration.dispose()
```

An application registration is stored as an application-level plugin registration. It attaches to every current Location and is installed during future Location boot. Disposal removes all current attachments and prevents future attachment.

The Effect implementation remains the canonical runtime. Promise and embedding wrappers are deferred until after the Effect API is stable.

## Migration Plan

### 1. Define Public Contracts

- Define `PluginHost` domain capabilities in `@opencode-ai/plugin/v2/effect`.
- Define SDK-typed editors for agent, catalog, command, integration, reference, skill, and tool.
- Define typed runtime hook maps per domain.
- Define `Registration`.
- Define typed `event.subscribe(type)`.

### 2. Generalize Registration Machinery

- Add one low-level scoped registration registry used by transforms and runtime hooks.
- Preserve plugin order and registration order.
- Support idempotent disposal and registration snapshots.
- Retain plugin position during same-ID replacement.

### 3. Evolve State

- Replace the current returned transform-slot updater with direct `transform(callback)` registration.
- Support Effectful callbacks.
- Add public `rebuild()`.
- Add rebuild serialization and coalescing.
- Add boot batching that defers automatic rebuilds.
- Move update event publication after commit.

### 4. Expand Domain Transform Hooks

- Agent
- Catalog
- Command
- Integration
- Reference
- Skill
- Tool

### 5. Migrate Existing Plugins

- Built-in agent transform
- Built-in command transform
- Built-in skill transform
- Models.dev catalog and integration transforms
- Config transforms
- OpenAI integration transform
- Provider catalog transforms

### 6. Migrate Runtime Hooks

- AI SDK resolution
- Language model resolution
- Tool execution hooks
- Session prompt/context hooks as required

### 7. Remove Returned Hooks

- Remove `HookFunctions` as the plugin setup return value.
- Remove catalog's special finalizer-triggered plugin hook path.
- Remove `plugin.added` catalog mutation handling.
- Make add/remove/replacement rely on scoped registration and domain rebuilds.

### 8. Add Event Adapter

- Build the SDK event discriminant map.
- Resolve public type strings to internal EventV2 definitions.
- Return typed Effect streams.

### 9. Verification

- Transform order is deterministic.
- Multiple transforms per plugin/domain compose.
- Registration and disposal rebuild automatically outside boot batches.
- Boot performs one rebuild per affected domain.
- Plugin setup failure removes prior registrations.
- Same-ID replacement retains order and disables the old plugin first.
- Rebuilds serialize and coalesce.
- Registration changes during replay affect the next rebuild.
- Same-domain recursive rebuild is rejected.
- Cross-domain rebuild requests from transforms are deferred.
- Hook execution is sequential and snapshot-based.
- Models.dev refresh replays config and provider transforms.
- Config and skill watcher refreshes remove stale entries.
- Plugin removal restores prior effective state.
- Events observe newly committed state.

## Deferred Decisions

- Promise API shape
- Typed error model
- Transform timeouts
- Cross-domain atomic rebuilds
- Automatic dependency tracking
- Whole-Location generation reload
- Exact editors and runtime hooks not required by current plugins
