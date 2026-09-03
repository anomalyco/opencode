# OpenCode V2 Effect Plugin API

The Effect plugin API grants plugins two in-process capabilities:

- `hook` installs behavior at an OpenCode extension point.
- `reload` reruns every transform hook for a stateful domain.

## Defining A Plugin

```ts
import { Plugin } from "@opencode-ai/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "example",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update("example", (provider) => {
        provider.name = "Example"
      })
    })
  }),
})
```

Plugin setup registers hooks imperatively through each domain's `hook` method.

Configuration supplied for the plugin is available as `ctx.options`.

Registrations are owned by the plugin scope. Closing the scope removes them automatically; a registration may also be removed early through `dispose`.

## Transform Hooks

Transform hooks contribute to stateful domains. Their editor callbacks are
synchronous, so load effectful data before registering a transform or reloading
its domain:

```ts
yield *
  ctx.agent.transform((agent) => {
    agent.update("reviewer", (item) => {
      item.description = "Reviews code for regressions"
      item.mode = "subagent"
    })
  })
```

Registry reads rebuild synchronously when registrations changed, applying every transform in registration order to a fresh value; unchanged registries return the previous value. Values read earlier are never mutated. Notifications and resource reconciliation run separately from that materialization.

Available transform hooks are namespaced by domain:

```ts
ctx.agent.transform
ctx.catalog.transform
ctx.command.transform
ctx.integration.transform
ctx.mcp.transform
ctx.reference.transform
ctx.skill.transform
ctx.tool.transform
ctx.vcs.transform
ctx.websearch.transform
```

## Runtime Hooks

Runtime hooks intercept live operations rather than rebuilding domain state:

```ts
yield *
  ctx.aisdk.hook(
    "sdk",
    Effect.fn(function* (event) {
      if (event.package !== "@ai-sdk/xai") return
      const mod = yield* Effect.promise(() => import("@ai-sdk/xai"))
      event.sdk = mod.createXai(event.options)
    }),
  )

yield *
  ctx.aisdk.hook("language", (event) =>
    Effect.sync(() => {
      if (event.model.providerID !== "xai") return
      event.language = event.sdk.responses(event.model.modelID)
    }),
  )
```

Hooks run sequentially in registration order. Later hooks observe mutations made by earlier hooks.

Session context is mutable immediately before provider dispatch. The purpose identifies whether the request belongs to
the session loop, direct generation, title generation, or compaction:

```ts
yield *
  ctx.session.hook("context", (event) =>
    Effect.sync(() => {
      if (event.purpose !== "session") return
      event.tools.read.description = "Read a file using narrow line ranges."
      delete event.tools.write
    }),
  )

yield *
  ctx.session.hook("retry", (event) =>
    Effect.sync(() => {
      if (event.attempt >= 3) event.decision = { retry: false }
    }),
  )
```

## Reloading A Domain

When data captured by a transform changes, reload the affected domain:

```ts
let data = yield * loadCatalog()

yield *
  ctx.catalog.transform((catalog) => {
    applyCatalog(data, catalog)
  })

data = yield * loadCatalog()
yield * ctx.catalog.reload()
```

Reload belongs to the domain, not an individual registration. `ctx.catalog.reload()` reruns every active catalog transform and publishes the rebuilt catalog.

Available reload operations are:

```ts
ctx.agent.reload()
ctx.catalog.reload()
ctx.command.reload()
ctx.integration.reload()
ctx.mcp.reload()
ctx.reference.reload()
ctx.skill.reload()
ctx.tool.reload()
ctx.vcs.reload()
ctx.websearch.reload()
```
