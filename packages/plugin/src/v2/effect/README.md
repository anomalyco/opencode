# OpenCode V2 Plugin API

> Design proposal. The API shown here is the intended V2 model and is not fully implemented yet.

This document explains how OpenCode V2 plugins contribute agents, commands, skills, integrations, providers, and models without importing `@opencode-ai/core`.

The design has four goals:

- Internal and external plugins use the same API.
- Plugin values use generated `@opencode-ai/sdk` types.
- Core may keep richer internal representations such as branded IDs and decoded Effect schemas.
- Plugins can react to changing data without reloading an entire Location.

## Mental Model

A plugin has two parts:

1. A setup effect that loads data, starts scoped subscriptions, and returns hooks.
2. Singular transform hooks that describe the plugin's current contribution to a domain.

```ts
export default defineEffectPlugin({
  id: "example",
  effect: (ctx) =>
    Effect.gen(function* () {
      return {
        "agent.transform": (agent) => {
          // Describe this plugin's agent contribution.
        },
      }
    }),
})
```

A transform is not a one-time mutation. It is a replayable declaration.

OpenCode may run it when:

- The plugin is added.
- The plugin is removed or replaced.
- Another plugin affecting the same domain changes.
- The plugin explicitly invalidates the domain.

Transforms must therefore be synchronous, deterministic, and safe to rerun.

## Why Hooks Are Returned

Each transform is a singular property of the plugin definition:

```ts
return {
  "catalog.transform": applyCatalog,
}
```

This makes it structurally clear that one plugin has at most one transform per domain. There is no ambiguous behavior from calling `transform()` multiple times during setup.

Transforms from different plugins compose in plugin order.

```text
models.dev catalog transform
→ config catalog transform
→ provider catalog transforms
→ user catalog transforms
→ core catalog finalizer
```

## Your First Plugin

This plugin adds a reviewer agent.

```ts
import { defineEffectPlugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"

export default defineEffectPlugin({
  id: "reviewer",
  effect: () =>
    Effect.succeed({
      "agent.transform": (agent) => {
        agent.update("reviewer", (item) => {
          item.description = "Reviews code for correctness and regressions"
          item.system = "Review the requested code. Prioritize bugs and behavioral regressions."
          item.mode = "subagent"
          item.hidden = false
        })
      },
    }),
})
```

The editor supplies a complete default agent when `reviewer` does not exist. The callback modifies that value using the generated SDK agent shape.

When the plugin unloads, OpenCode rebuilds the agent registry without this transform. The reviewer disappears automatically.

## Transform Editors

Editors support ordered reads and writes while a domain is being rebuilt.

```ts
"agent.transform": (agent) => {
  const existing = agent.get("reviewer")

  agent.update("reviewer", (item) => {
    item.description ??= existing?.description ?? "Reviews code"
  })
}
```

An editor is valid only during the transform call. Do not retain it in plugin state.

Later plugins see mutations made by earlier plugins in the same rebuild.

## Adding A Provider And Model

This plugin contributes one provider and one model.

```ts
import { defineEffectPlugin } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"

export default defineEffectPlugin({
  id: "acme",
  effect: () =>
    Effect.succeed({
      "catalog.transform": (catalog) => {
        catalog.provider.update("acme", (provider) => {
          provider.name = "Acme AI"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.acme.example/v1",
          }
        })

        catalog.model.update("acme", "acme-chat", (model) => {
          model.name = "Acme Chat"
          model.family = "acme"
          model.api = {
            id: "acme-chat",
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://api.acme.example/v1",
          }
          model.capabilities = {
            tools: true,
            input: ["text"],
            output: ["text"],
          }
          model.time.released = Date.now()
          model.status = "active"
          model.enabled = true
          model.limit = {
            context: 128_000,
            output: 16_384,
          }
        })
      },
    }),
})
```

The provider and model values use generated SDK types. Core may encode and decode richer internal schema values at the plugin boundary.

## Dynamic Data And Invalidation

Some plugins depend on data that changes after setup. Examples include:

- models.dev refreshes
- config file watchers
- skill directory watchers
- authentication state changes

The plugin keeps the current data in its own scoped state. When that data changes, it invalidates each affected domain.

```ts
let data = yield * loadData()

return {
  "catalog.transform": (catalog) => {
    applyCatalog(data, catalog)
  },
}
```

After changing `data`:

```ts
data = yield * loadData()
yield * ctx.catalog.invalidate()
```

Invalidation does not mutate the current catalog in place. It requests a rebuild:

```text
create fresh catalog state
→ replay every catalog transform in plugin order
→ run the core catalog finalizer
→ commit the new catalog
→ publish catalog.updated
```

Repeated invalidations are serialized and may be coalesced.

## Models.dev Example

Models.dev is the main example of a dynamic plugin. It projects one changing source into the integration and catalog domains.

```ts
import { defineEffectPlugin } from "@opencode-ai/plugin/v2/effect"
import { Effect, Stream } from "effect"

export default defineEffectPlugin({
  id: "models-dev",
  effect: (ctx) =>
    Effect.gen(function* () {
      const modelsDev = yield* ModelsDev.Service
      const events = yield* EventV2.Service
      let data = yield* modelsDev.get()

      yield* events.subscribe(ModelsDev.Event.Refreshed).pipe(
        Stream.runForEach(
          Effect.fn(function* () {
            data = yield* modelsDev.get()
            yield* ctx.integration.invalidate()
            yield* ctx.catalog.invalidate()
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )

      return {
        "integration.transform": (integration) => {
          for (const provider of Object.values(data)) {
            if (provider.env.length === 0) continue

            integration.update(provider.id, (item) => {
              item.name = provider.name
            })

            integration.method.update({
              integrationID: provider.id,
              method: { type: "key" },
            })

            integration.method.update({
              integrationID: provider.id,
              method: {
                type: "env",
                names: [...provider.env],
              },
            })
          }
        },

        "catalog.transform": (catalog) => {
          for (const provider of Object.values(data)) {
            applyProvider(provider, catalog)
          }
        },
      }
    }),
})
```

`ModelsDev.Service` and `ModelsDev.Event` are privileged internal dependencies in this example. The integration and catalog contributions still use the same hooks available to external plugins.

This design intentionally does not require a special multi-domain transform. The two domains rebuild independently. If strict cross-domain atomic publication becomes a requirement, it should be designed separately rather than making every transform combinatorial.

## Config File Watching

A config plugin can project one parsed config snapshot into several independent domains.

```ts
export default defineEffectPlugin({
  id: "config",
  effect: (ctx) =>
    Effect.gen(function* () {
      let config = yield* loadConfig()

      yield* watchConfig.pipe(
        Stream.runForEach(
          Effect.fn(function* () {
            config = yield* loadConfig()
            yield* ctx.agent.invalidate()
            yield* ctx.command.invalidate()
            yield* ctx.catalog.invalidate()
            yield* ctx.integration.invalidate()
            yield* ctx.reference.invalidate()
            yield* ctx.skill.invalidate()
          }),
        ),
        Effect.forkScoped,
      )

      return {
        "agent.transform": (agent) => applyAgentConfig(config, agent),
        "command.transform": (command) => applyCommandConfig(config, command),
        "catalog.transform": (catalog) => applyProviderConfig(config, catalog),
        "integration.transform": (integration) => applyIntegrationConfig(config, integration),
        "reference.transform": (reference) => applyReferenceConfig(config, reference),
        "skill.transform": (skill) => applySkillConfig(config, skill),
      }
    }),
})
```

The watcher performs I/O. The transforms only project the latest in-memory snapshot.

## Skill Directory Watching

A skill plugin follows the same pattern.

```ts
export default defineEffectPlugin({
  id: "workspace-skills",
  effect: (ctx) =>
    Effect.gen(function* () {
      let sources = yield* discoverSkills()

      yield* watchSkillDirectories.pipe(
        Stream.runForEach(
          Effect.fn(function* () {
            sources = yield* discoverSkills()
            yield* ctx.skill.invalidate()
          }),
        ),
        Effect.forkScoped,
      )

      return {
        "skill.transform": (skill) => {
          for (const source of sources) skill.source(source)
        },
      }
    }),
})
```

Rebuilding the source registry may not be enough if discovered skill contents are cached separately. Domain invalidation must include all materialized state owned by that domain.

## Runtime Hooks

Transform hooks build registry state. Runtime hooks intercept live operations.

```ts
return {
  "catalog.transform": (catalog) => {
    // Synchronous and replayable.
  },

  "aisdk.sdk": Effect.fn(function* (event) {
    // Runs when OpenCode needs an AI SDK provider.
  }),

  "aisdk.language": Effect.fn(function* (event) {
    // Runs when OpenCode selects a language model implementation.
  }),
}
```

Runtime hooks may perform Effects appropriate to the operation. Transform hooks must remain replay-safe.

## Integration Authentication

Executable registrations may be installed during an integration transform.

```ts
return {
  "integration.transform": (integration) => {
    integration.update("openai", (item) => {
      item.name = "OpenAI"
    })

    integration.method.update({
      integrationID: "openai",
      method: {
        id: "chatgpt-browser",
        type: "oauth",
        label: "ChatGPT Pro/Plus (browser)",
      },
      authorize: browserAuthorize,
      refresh: refreshCredential,
    })
  },
}
```

Replay installs callback values. It must not start OAuth, open a server, or refresh credentials. Those effects run later when core invokes the stored implementation.

## Reading Other Domains

A transform may need information from another committed domain.

```ts
"agent.transform": (agent) => {
  if (!anthropicAvailable) return

  agent.update("anthropic-reviewer", (item) => {
    item.model = {
      providerID: "anthropic",
      id: "claude-sonnet",
    }
  })
}
```

Load or subscribe to the dependency during setup, keep a local snapshot, and invalidate the dependent domain when the snapshot changes.

```ts
let anthropicAvailable = yield * readAnthropicAvailability()

yield *
  catalogChanges.pipe(
    Stream.runForEach(
      Effect.fn(function* () {
        anthropicAvailable = yield* readAnthropicAvailability()
        yield* ctx.agent.invalidate()
      }),
    ),
    Effect.forkScoped,
  )
```

This keeps transform callbacks synchronous and avoids hidden dependency tracking.

## Plugin Order

OpenCode's default distribution uses an opinionated order.

```text
1. Built-in agents, commands, and skills
2. Base data sources such as models.dev
3. Configuration projections
4. Provider-specific normalization and authentication
5. External user plugins
6. Core domain finalization
```

For the catalog:

```text
models.dev
→ config provider overrides
→ built-in provider normalization
→ user catalog transforms
→ policy and validation
→ commit
→ catalog.updated
```

Ordering is observable behavior. Later transforms see and may override earlier transforms.

## Core Finalization

Plugin transforms and core finalization are different concepts.

Transforms describe configurable plugin contributions. Core finalization enforces domain invariants.

Catalog finalization may:

- Validate the materialized catalog.
- Apply provider-use policy.
- Build indexes.
- Commit the new snapshot.
- Publish `catalog.updated` after the new snapshot is visible.

Reference finalization may materialize Git-backed references. Integration finalization may update connection projections and publish events.

Core finalizers always run after plugin transforms for that domain.

## Add, Remove, And Replace

When a plugin is added, OpenCode invalidates every domain for which it returned a transform.

When a plugin is removed, OpenCode removes its hooks and invalidates those domains. Rebuilding from base state automatically removes the plugin's prior mutations.

When a plugin is replaced, OpenCode swaps its hooks, preserves the intended plugin order, and invalidates the affected domains.

No plugin-specific undo callback is required.

## Effect API

The Effect API exposes Effect-native setup, runtime hooks, scopes, interruption, and typed failures.

```ts
export type EffectPlugin = (ctx: EffectPluginContext) => Effect.Effect<PluginHooks | void, PluginError, Scope.Scope>
```

The setup scope owns:

- Event subscriptions
- Watchers
- Background fibers
- Plugin hooks

Closing the scope unloads the plugin and invalidates its transformed domains.

## Promise API

The Promise API uses the same SDK values, hook names, editors, and lifecycle semantics.

```ts
export default definePlugin({
  id: "reviewer",
  plugin: async () => ({
    "agent.transform": (agent) => {
      agent.update("reviewer", (item) => {
        item.description = "Reviews code"
        item.mode = "subagent"
        item.hidden = false
      })
    },
  }),
})
```

Promise plugins receive Promise-returning host capabilities:

```ts
await ctx.catalog.invalidate()
```

Core implements the Promise API by running the canonical Effect capabilities. It manages the plugin scope automatically.

## Rules For Transform Hooks

Transform hooks must:

- Be synchronous.
- Be deterministic for their captured snapshot.
- Avoid network, filesystem, process, and database I/O.
- Avoid publishing events.
- Avoid invalidating a domain while that domain is rebuilding.
- Avoid retaining the editor after returning.

Transform hooks may:

- Read the editor's current materialized state.
- Add, update, and remove domain entries.
- Install executable callback values for later use.
- Read immutable or plugin-owned captured data.

## Runtime Requirements

The plugin runtime must provide these guarantees:

- Hooks replay in deterministic plugin order.
- Only one rebuild per domain runs at a time.
- Repeated invalidations may be coalesced.
- Rebuilds use fresh temporary state.
- Failed rebuilds leave the previous committed state intact.
- Core finalization runs after all plugin transforms.
- Update events publish only after the new state is visible.
- Plugin add, remove, and replacement invalidate affected domains automatically.
- A transform cannot invalidate the domain currently running it.

## Summary

Use setup for effects and transforms for declarations.

```ts
effect: (ctx) =>
  Effect.gen(function* () {
    let data = yield* loadData()

    yield* watchData.pipe(
      Stream.runForEach(
        Effect.fn(function* () {
          data = yield* loadData()
          yield* ctx.catalog.invalidate()
        }),
      ),
      Effect.forkScoped,
    )

    return {
      "catalog.transform": (catalog) => {
        applyCatalog(data, catalog)
      },
    }
  })
```

The plugin owns changing source data. The runtime owns hook ordering, replay, invalidation, cleanup, and commit. Core services own their state and finalization.
