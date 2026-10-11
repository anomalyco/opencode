import { ConfigPolicyPlugin } from "@opencode/core/config/plugin/policy"
import { Mcp } from "@opencode/core/mcp/index"
import { Skill } from "@opencode/core/skill"
import { ID } from "@opencode/schema/event"
import { Effect, Stream } from "effect"
import { host } from "../plugin/host"

// Exercise the real policy plugin against supplied catalogs without unrelated provider/permission setup.
export const registerIntegrationPolicy = Effect.fn(function* (input: {
  mcp?: Mcp.Interface
  skill?: Skill.Interface
  events?: Stream.Stream<{ readonly type: string }, unknown>
}) {
  yield* ConfigPolicyPlugin.Plugin.effect(
    host({
      event: {
        subscribe: () =>
          (input.events ?? Stream.never).pipe(
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
      integration: {
        list: () => Effect.die("unused integration.list"),
        get: () => Effect.die("unused integration.get"),
        transform: () => Effect.succeed({ dispose: Effect.void }),
        reload: () => Effect.void,
        connect: {
          key: () => Effect.die("unused integration.connect.key"),
          external: () => Effect.die("unused integration.connect.external"),
        },
        oauth: {
          connect: () => Effect.die("unused integration.oauth.connect"),
          status: () => Effect.die("unused integration.oauth.status"),
          complete: () => Effect.die("unused integration.oauth.complete"),
          cancel: () => Effect.die("unused integration.oauth.cancel"),
        },
        command: {
          connect: () => Effect.die("unused integration.command.connect"),
          status: () => Effect.die("unused integration.command.status"),
          cancel: () => Effect.die("unused integration.command.cancel"),
        },
        connection: {
          active: () => Effect.die("unused integration.connection.active"),
          resolve: () => Effect.die("unused integration.connection.resolve"),
          status: () => Effect.die("unused integration.connection.status"),
        },
      },
      mcp: {
        list: () => Effect.die("unused mcp.list"),
        transform: (callback) => input.mcp?.transform(callback) ?? Effect.succeed({ dispose: Effect.void }),
        reload: () => input.mcp?.reload() ?? Effect.void,
      },
      skill: {
        list: () => Effect.die("unused skill.list"),
        transform: (callback) => input.skill?.transform(callback) ?? Effect.succeed({ dispose: Effect.void }),
        reload: () => input.skill?.reload() ?? Effect.void,
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
