# @opencode-ai/sdk-next

Effect-native scoped OpenCode host for in-process applications. This transitional package will replace the existing generated `@opencode-ai/sdk` after its consumers migrate.

The SDK executes Server's assembled HTTP router in memory. It opens no listener and performs no network I/O, while preserving the same routing, middleware, handlers, codecs, and errors as the network client.

```ts
import { OpenCode } from "@opencode-ai/sdk-next"

const opencode = yield * OpenCode.create()
const session = yield * opencode.sessions.get({ sessionID })
```

It also exports `Tool` for plugins that add tools with `ctx.tool.transform(...)`. Embedded plugins run through the ordinary discovery flow and register tools into each Location's `ToolRegistry` through the normal `Tools.Service.register(...)` path. Closing the owning Effect Scope releases router resources, location services, fibers, and scoped tool registrations.

`sessions.events({ sessionID, after })` replays durable events after the optional aggregate sequence, then emits newly committed durable events. `sessions.interrupt(...)` targets execution owned by this host, and `sessions.message(...)` retrieves one projected Session message.

The same constructor is available as a service Layer:

```ts
const program = Effect.gen(function* () {
  const opencode = yield* OpenCode.Service
  return yield* opencode.sessions.get({ sessionID })
})

yield * program.pipe(Effect.provide(OpenCode.layer))
```

`OpenCode.layer` adapts `OpenCode.create()` for dependency injection; it does not define another host implementation.
