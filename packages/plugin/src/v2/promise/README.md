# OpenCode V2 Promise Plugin API

The Promise plugin API at `@opencode-ai/plugin/v2` is the async/await equivalent of `@opencode-ai/plugin/v2/effect`. It grants plugins the same two in-process capabilities:

- `hook` installs behavior at an OpenCode extension point.
- `reload` reruns every transform hook for a stateful domain.

The only difference from the Effect API is the async boundary: hook callbacks, hook registration, `reload`, and `Registration.dispose` use Promises instead of Effects.

## Defining A Plugin

```ts
import { Plugin } from "@opencode-ai/plugin/v2"

export default Plugin.define({
  id: "example",
  setup: async (ctx) => {
    await ctx.catalog.transform((catalog) => {
      catalog.provider.update("example", (provider) => {
        provider.name = "Example"
      })
    })
  },
})
```

Plugin setup registers hooks imperatively through each domain's `hook` method.
It may return a synchronous or asynchronous cleanup function. OpenCode awaits
the cleanup when the plugin is unloaded or replaced:

```ts
setup: async (ctx) => {
  const timer = setInterval(refresh, 60_000)
  return () => clearInterval(timer)
}
```

Configuration supplied for the plugin is available as `ctx.options`.

A registration may be removed early through `dispose`:

```ts
const registration = await ctx.catalog.transform(applyCatalog)
await registration.dispose()
```

## Transform Hooks

Transform hooks contribute to stateful domains. The draft editor is synchronous; the callback may be `async` when it needs to await other work:

```ts
await ctx.agent.transform((agent) => {
  agent.update("reviewer", (item) => {
    item.description = "Reviews code for regressions"
    item.mode = "subagent"
  })
})
```

Available transform hooks are namespaced by domain:

```ts
ctx.agent.transform
ctx.catalog.transform
ctx.command.transform
ctx.integration.transform
ctx.reference.transform
ctx.skill.transform
```

## Runtime Hooks

Runtime hooks intercept live operations:

```ts
await ctx.aisdk.hook("sdk", async (event) => {
  if (event.package !== "@ai-sdk/xai") return
  const mod = await import("@ai-sdk/xai")
  event.sdk = mod.createXai(event.options)
})

await ctx.aisdk.hook("language", (event) => {
  if (event.model.providerID !== "xai") return
  event.language = event.sdk.responses(event.model.api.id)
})
```

Session context is mutable immediately before provider dispatch:

```ts
await ctx.session.hook("context", (event) => {
  event.tools.read.description = "Read a file using narrow line ranges."
  delete event.tools.write
})
```

Promise tools use plain object declarations with async executors:

```ts
import { Schema } from "effect"

await ctx.tool.transform((tools) => {
  tools.add({
    name: "echo",
    description: "Echo text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: async ({ text }) => ({ text }),
  })
})
```

## Reloading A Domain

When data captured by a transform changes, reload the affected domain:

```ts
let data = await loadCatalog()

await ctx.catalog.transform((catalog) => {
  applyCatalog(data, catalog)
})

data = await loadCatalog()
await ctx.catalog.reload()
```

Available reload operations are:

```ts
ctx.agent.reload()
ctx.catalog.reload()
ctx.command.reload()
ctx.integration.reload()
ctx.reference.reload()
ctx.skill.reload()
```
