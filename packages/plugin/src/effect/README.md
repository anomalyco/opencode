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

## Experimental Terminal Reads

`ctx.experimental` has no compatibility guarantees. Its methods use the generated
Effect client API contracts; terminal reads do not register a tool.

```ts
const terminal = yield * ctx.experimental.terminal.read({ sessionID, lines: 100 })
if (terminal) console.log(terminal.screen.text)
```

The result is `PersistentPty.ReadResult` or `null` when the session has no selected
terminal. It contains `ptyID`, `title`, `cwd`, nullable `foregroundProcess`, and
`screen: { text, cols, rows, cursor: { x, y } }`.

The selected terminal is the one most recently successfully attached as controller,
resized, given control, or sent input for that session. Reads, observer attachments, and
hiding a terminal do not change the selection. The selection map is process-local
and resets when the server restarts.

Omitting `lines` returns the viewport height's worth of text. An explicit `lines`
must be an integer from 1 through 65535 and counts the total number of trailing
rows, not extra scrollback in addition to the viewport. `screen.cols` and
`screen.rows` remain the actual PTY dimensions even when `screen.text` contains
more rows than the viewport. Invalid `lines` and daemon errors fail the Effect;
they are not converted to `null`.

Rows retain physical wrapping and blank lines. Counts larger than the retained
buffer return all available rows; reads do not follow the TUI's local scroll position.

## Transform Hooks

Transform hooks contribute to stateful domains:

```ts
yield *
  ctx.agent.transform((agent) => {
    agent.update("reviewer", (item) => {
      item.description = "Reviews code for regressions"
      item.mode = "subagent"
    })
  })
```

OpenCode rebuilds the domain when a transform is registered or disposed. A rebuild starts from fresh domain state and runs every active transform in registration order.

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
  ctx.aisdk.hook("language", (event) => {
    if (event.model.providerID !== "xai") return
    event.language = event.sdk.responses(event.model.api.id)
  })
```

Hooks run sequentially in registration order. Later hooks observe mutations made by earlier hooks.

Session context is mutable immediately before provider dispatch:

```ts
yield *
  ctx.session.hook("context", (event) =>
    Effect.sync(() => {
      event.tools.read.description = "Read a file using narrow line ranges."
      delete event.tools.write
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
ctx.reference.reload()
ctx.skill.reload()
```
