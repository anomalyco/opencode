# OpenCode V2 Promise Plugin API

The Promise plugin API is the async/await equivalent of `@opencode-ai/plugin/v2/effect`. It grants plugins the same two in-process capabilities:

- `hook` installs behavior at an OpenCode extension point.
- `reload` reruns every transform hook for a stateful domain.

The only difference from the Effect API is the async boundary: hook callbacks, hook registration, `reload`, and `Registration.dispose` use Promises instead of Effects.

## Defining A Plugin

```ts
import { define } from "@opencode-ai/plugin/v2/promise"

export const Plugin = define({
  id: "example",
  setup: async (ctx) => {
    await ctx.hook.catalog.transform((catalog) => {
      catalog.provider.update("example", (provider) => {
        provider.name = "Example"
      })
    })
  },
})
```

Plugin setup registers hooks imperatively. It does not return a hook object.

Configuration supplied for the plugin is available as `ctx.options`.

A registration may be removed early through `dispose`:

```ts
const registration = await ctx.hook.catalog.transform(applyCatalog)
await registration.dispose()
```

## Transform Hooks

Transform hooks contribute to stateful domains. The draft editor is synchronous; the callback may be `async` when it needs to await other work:

```ts
await ctx.hook.agent.transform((agent) => {
  agent.update("reviewer", (item) => {
    item.description = "Reviews code for regressions"
    item.mode = "subagent"
  })
})
```

Available transform hooks are namespaced by domain:

```ts
ctx.hook.agent.transform
ctx.hook.catalog.transform
ctx.hook.command.transform
ctx.hook.integration.transform
ctx.hook.reference.transform
ctx.hook.skill.transform
```

## Runtime Hooks

Runtime hooks intercept live operations:

```ts
await ctx.hook.aisdk.sdk(async (event) => {
  if (event.package !== "@ai-sdk/xai") return
  const mod = await import("@ai-sdk/xai")
  event.sdk = mod.createXai(event.options)
})

await ctx.hook.aisdk.language((event) => {
  if (event.model.providerID !== "xai") return
  event.language = event.sdk.responses(event.model.api.id)
})
```

## Reloading A Domain

When data captured by a transform changes, reload the affected domain:

```ts
let data = await loadCatalog()

await ctx.hook.catalog.transform((catalog) => {
  applyCatalog(data, catalog)
})

data = await loadCatalog()
await ctx.reload.catalog()
```

Available reload operations are:

```ts
ctx.reload.agent()
ctx.reload.catalog()
ctx.reload.command()
ctx.reload.integration()
ctx.reload.reference()
ctx.reload.skill()
```
