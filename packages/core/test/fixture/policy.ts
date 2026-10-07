import { ConfigPolicyPlugin } from "@opencode/core/config/plugin/policy"
import { Mcp } from "@opencode/core/mcp/index"
import { ID } from "@opencode/schema/event"
import { Effect, Stream } from "effect"
import { host } from "../plugin/host"

// Exercise the real policy plugin against a live MCP catalog without unrelated provider/permission setup.
export const registerIntegrationPolicy = Effect.fn(function* (
  mcp: Mcp.Interface,
  events: Stream.Stream<{ readonly type: string }, unknown> = Stream.never,
) {
  yield* ConfigPolicyPlugin.Plugin.effect(
    host({
      event: {
        subscribe: () =>
          events.pipe(
            Stream.filter((event) => event.type === "config.updated"),
            Stream.map(() => ({ id: ID.create(), created: Date.now(), type: "config.updated" as const, data: {} })),
          ),
      },
      provider: {
        list: () => Effect.die("unused provider.list"),
        get: () => Effect.die("unused provider.get"),
        transform: () => Effect.succeed({ dispose: Effect.void }),
        reload: () => Effect.void,
      },
      mcp: {
        list: () => Effect.die("unused mcp.list"),
        transform: (callback) => mcp.transform(callback),
        reload: mcp.reload,
      },
      permission: {
        hook: () => Effect.succeed({ dispose: Effect.void }),
        list: () => Effect.die("unused permission.list"),
        get: () => Effect.die("unused permission.get"),
        reply: () => Effect.die("unused permission.reply"),
      },
    }),
  )
})
