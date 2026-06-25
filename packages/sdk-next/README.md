# @opencode-ai/sdk-next

Effect-native scoped OpenCode host for in-process applications. This transitional package will replace the existing generated `@opencode-ai/sdk` after its consumers migrate.

The SDK executes Server's assembled HTTP router in memory. It opens no listener and performs no network I/O, while preserving the same routing, middleware, handlers, codecs, and errors as the network client.

```ts
import { OpenCode } from "@opencode-ai/sdk-next"

const opencode = yield * OpenCode.create()
const session = yield * opencode.sessions.get({ sessionID })
```

It also exposes local-only `tools.register(...)`. Closing the owning Effect Scope releases router resources, location services, fibers, and scoped tool registrations.

The same constructor is available as a service Layer:

```ts
const program = Effect.gen(function* () {
  const opencode = yield* OpenCode.Service
  return yield* opencode.sessions.get({ sessionID })
})

yield * program.pipe(Effect.provide(OpenCode.layer))
```

`OpenCode.layer` adapts `OpenCode.create()` for dependency injection; it does not define another host implementation.
