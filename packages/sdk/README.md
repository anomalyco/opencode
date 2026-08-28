# @opencode-ai/sdk

In-process OpenCode for Promise and Effect applications. The existing `OpenCode` host executes Server's assembled HTTP router in memory, opening no listener and adding no network hop. The direct Effect entrypoint binds Session handles to private instances without constructing a router or location map.

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

The Effect Workerd entrypoint is `@opencode-ai/sdk/workerd/effect`.

## Direct Effect Sessions

Use `@opencode-ai/sdk/direct/effect` when the application owns Session lifetimes and supplies imported Effect plugins. Provide `Shared.layer` once, then create a private instance for each active conversation. Two handles at the same directory have independent tools, agents, config, and plugin registrations while sharing the configured database, credentials, and execution coordinator.

```ts
import { AbsolutePath, Location, Session, Shared } from "@opencode-ai/sdk/direct/effect"
import { Effect } from "effect"
import threadTools from "./thread-tools"

const program = Effect.gen(function* () {
  const session = yield* Session.create({
    location: Location.Ref.make({ directory: AbsolutePath.make("/workspace") }),
    plugins: [threadTools],
  })

  yield* session.events.subscribe((event) => Effect.log(event.type))
  yield* session.prompt({ text: "Inspect the latest request" })
  yield* session.wait()
})

await Effect.runPromise(
  program.pipe(Effect.provide(Shared.layer({ database: { path: "./bot.sqlite" } })), Effect.scoped),
)
```

`Session.create` waits for plugin and initial MCP-tool readiness but does not execute the Session. Filesystem discovery defaults to `false` on this entrypoint; set `discovery: true` to opt into ambient config and instructions. Imported plugins can configure capabilities without filesystem discovery. Runtime options and plugins are not persisted as Session metadata.

Pass an existing `id` to adopt stored history. The saved title, model, metadata, and location win over retry arguments; location may be omitted when adopting. Install an observer before explicitly calling `session.resume()` to recover admitted work using the new instance's capabilities. A second live handle for the same Session fails with `Session.AlreadyBoundError` rather than replacing the first instance.

`prompt` durably admits input before scheduling execution; `resume: false` admits only. `resume()` starts or joins execution, `interrupt()` requests user interruption, and `wait()` waits for local execution to settle without starting it. Child Sessions created by subagent tools inherit their parent's instance. Closing either the caller's Scope or the supplied Shared layer settles bound execution before disposing capabilities, preserves shutdown recovery claims, and makes retained handle methods fail with `Session.ClosedError`. Private instances close before shared backing is released. Keep the provided program and Scope open for the lifetime of an active thread, not just one inbound message.

`events.subscribe(callback)` is ready before returning. It returns the observation fiber, whose failure can be observed by the caller, and disposes with either the subscription's Scope or the handle's Scope. Events are live and Session-specific, not a replay feed or an exactly-once outbound-delivery guarantee. Callbacks run outside publication transactions.

Direct `resume()` drains the selected Session. `Shared.layer` does not run the server's automatic restart or background-Job recovery sweep. Automatic restoration of background Jobs after reopening handles is not part of this entrypoint yet; shutdown retains their durable recovery markers rather than turning them into user cancellations.

`Shared.layer` defaults to an in-memory database. Explicit relative database paths are resolved against the application working directory. Advanced `replacements` on `Shared.layer` configure fully wired, infallible shared implementations; constructor replacements configure instance-local services. For lower-level Effect composition, Core's `Instance.compose` requires its explicit shared infrastructure and preserves replacement dependencies and errors. The initial direct handle is placement-bound and does not expose movement or a Promise facade. Existing embedded and Workerd entrypoints retain their behavior.
