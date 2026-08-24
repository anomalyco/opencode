# @opencode-ai/sdk

In-process OpenCode host for Promise and Effect applications. The SDK executes Server's assembled HTTP router in memory, opening no listener and adding no network hop.

```ts
import { OpenCode } from "@opencode-ai/sdk"

await using opencode = await OpenCode.create()
const session = await opencode.sessions.create({
  location: { directory: "/workspace" },
})
```

Pass imported Promise plugins in `plugins`, or register one later with `await opencode.plugin(plugin)`.

The Promise API uses the same values, errors, request options, and `AsyncIterable` streams as `@opencode-ai/client`.

Embedded hosts are silent by default. Set `log` to receive structured log entries:

```ts
await using opencode = await OpenCode.create({
  log: {
    level: "warn",
    emit: (entry) => console.error(entry.message, entry.attributes, entry.cause),
  },
})
```

`close()` and `Symbol.asyncDispose` release router resources, Location services, fibers, and scoped plugin registrations.

## Workerd

Use the Workerd entrypoint inside a Cloudflare Durable Object. Hold one host for the lifetime of the object instance rather than creating one per request.

```ts
import { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"
import myPlugin from "./my-plugin"

export class OpenCodeDO {
  private readonly opencode: Promise<OpenCodeWorkerd.Interface>

  constructor(state: DurableObjectState) {
    this.opencode = state.blockConcurrencyWhile(() =>
      OpenCodeWorkerd.create({
        storage: state.storage,
        config: { default_agent: "build" },
        plugins: [myPlugin],
      }),
    )
  }

  async fetch() {
    const opencode = await this.opencode
    return Response.json(await opencode.health.get())
  }
}
```

`blockConcurrencyWhile` keeps every Durable Object event out until the host is ready and resets the object if initialization fails. The retained Promise gives request handlers direct access to the same host after startup. Configuration is a typed JavaScript object, and plugins are imported values bundled with the Worker.

## Effect

The Effect-native API remains available from `@opencode-ai/sdk/effect`:

```ts
import { OpenCode } from "@opencode-ai/sdk/effect"

const opencode = yield * OpenCode.create()
const session = yield * opencode.sessions.get({ sessionID })
```

`OpenCode.create()` and `OpenCode.layer()` start recovery automatically. Use `OpenCode.layerWith()` when plugins come from registration Layers so recovery starts only after those Layers succeed:

```ts
import { OpenCode } from "@opencode-ai/sdk/effect"
import { Effect, Layer } from "effect"
import myPlugin from "./my-plugin"

const PluginLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const opencode = yield* OpenCode.Service
    yield* opencode.plugin(myPlugin)
  }),
)

const OpenCodeLive = OpenCode.layerWith(PluginLive)
```

The Effect Workerd entrypoint is `@opencode-ai/sdk/workerd/effect`, with a matching `layerWith` export.
