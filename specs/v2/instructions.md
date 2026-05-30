# V2 Core Instructions

These notes describe how to work on `packages/core` during the v2 port.

## Direction

Move behavior out of large application services and into plugins. Core services should become small, typed containers that own state, expose simple operations, and trigger hooks where policy or integration-specific logic belongs.

The target shape is:

- `packages/core` contains domain schemas, typed errors, state containers, events, and plugin hook contracts.
- Plugins implement provider-specific, config-specific, auth-specific, model-discovery, and generation behavior.
- Services are hot-reloadable by design: updates are granular, observable, and do not require tearing down the whole process.
- `packages/opencode` becomes thinner over time: UI, server routes, CLI, storage glue, and legacy compatibility should call the core services instead of owning domain logic directly.

## Service Shape

Core services should look like `Catalog`, `AccountV2`, and `AgentV2`:

- define schemas and branded ids at the top of the module
- define typed `Schema.TaggedErrorClass` errors for expected failures
- define an `Interface` with small operations
- expose a `Context.Service`
- implement `layer` with private in-memory state
- expose `defaultLayer` with explicit dependencies
- self-export with `export * as Name from "./file"`

Prefer a dumb container API:

- `get`, `all`, `available`, `default`, `update`, `remove`, `activate`, or other small domain verbs
- `update(id, draft => ...)` for registration and mutation
- hook calls before committing mutations when plugins need to enrich, cancel, or validate changes
- events after committing mutations when other services or frontends need to react

Avoid putting application policy directly in core services unless it is a domain invariant. For example, resolving model endpoint inheritance is catalog-owned; deciding which providers to register is plugin-owned.

## Plugin Hooks

Plugins are the extension boundary for v2. Add hooks to `PluginV2.HookSpec` when logic should be provided by integrations instead of the container itself.

Hook conventions:

- hooks receive immutable input plus mutable output
- mutable object outputs are exposed as Immer drafts
- include `cancel: boolean` when plugins can prevent a mutation
- trigger hooks sequentially so ordering remains deterministic
- keep hook names domain-oriented, like `provider.update`, `model.update`, `account.activate`, `agent.generate`
- keep hook payloads small and typed with core schemas

Use hooks for:

- registering providers and models
- applying env/account/config-derived enablement
- transforming SDK/provider options
- implementing generated behavior such as agent generation
- choosing defaults when the choice is policy rather than state

Do not use hooks as a dumping ground for transport concerns, UI behavior, or compatibility shims.

## Plugin Boot

Built-in core plugins are registered by `packages/core/src/plugin/boot.ts`.

When a new core service is intended to be available to plugins:

- add the service to the boot layer dependency type
- yield the service inside the layer
- provide it to each plugin effect in `add`
- add its default layer to `PluginBoot.defaultLayer` only when that does not create a cycle

Keep boot as composition only. It should not contain provider, account, agent, or model policy itself.

## Boundaries

Core should not import from `packages/opencode`. If a type or concept is needed by core, move or remodel the domain shape in core first.

Avoid moving legacy services over wholesale. Port the domain shape and the container API, then leave specific behavior behind hooks for plugins to implement.

When porting an opencode service:

- identify the state it owns
- identify the operations callers actually need
- identify which branches are policy or integration behavior
- model state and operations in `packages/core`
- add hooks for the policy/integration branches
- keep old package code working until callers can migrate incrementally

## Schemas And Types

Use Effect schemas as the public contract:

- branded schemas for ids
- `Schema.Class` or `Schema.Struct` for domain data
- `Schema.TaggedErrorClass` for expected errors
- existing core helpers like `DeepMutable`, `withStatics`, and integer schemas where appropriate

Prefer `Info` objects as the stored domain records. Add static `empty(...)` constructors when update APIs need to create records on first mutation.

Keep schemas stable and explicit. Do not rely on opencode config shapes as core domain shapes unless the config shape is actually the domain model.

## State And Events

Keep state private to the service layer. Use immutable replacement or Effect refs when persistence/concurrency requires it.

Publish events for committed domain changes, not for attempted mutations. Event names should describe domain facts, for example `catalog.model.updated`.

The v2 goal is granular reconfiguration. A model update should let dependents react to that model update; it should not require global reloads.

## Style

Follow the local core style:

- `Effect.gen(function* () { ... })` for composition
- `Effect.fn("Domain.method")` for public service methods
- `Effect.fnUntraced` for small internal mutation helpers
- `yield* new ErrorClass(...)` for typed failures
- minimal helpers unless they name a real concept
- no `any` unless an existing plugin boundary requires it
- no compatibility code without a concrete persisted or external-consumer need

Prefer the smallest correct port. The goal is to make services easier to replace and reason about, not to recreate the old architecture in a new package.
