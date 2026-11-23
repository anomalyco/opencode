import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Stream } from "effect"
import { ClaudeAccounts } from "./claude/accounts.js"
import { ClaudeIO } from "./claude/io.js"
import { ClaudeSessions } from "./claude/sessions.js"
import { ClaudeStatus } from "./claude/status.js"
import { ClaudeAISDK } from "./aisdk.js"
import { ClaudeInstructions } from "./instructions.js"
import { ClaudeIntegration } from "./integration.js"
import { ClaudeProvider } from "./provider.js"
import { ClaudeSessionHooks } from "./session.js"
import { ClaudeWebSearchProvider } from "./websearch.js"
import { Environment } from "../../../environment/index.js"
import { EnvironmentUnavailable } from "../../../environment/unavailable.js"
import { Location } from "../../../location.js"
import type { PluginInternal } from "../../internal.js"

export const ID = "opencode.provider.claude-agent"

// Tests pass a fake ClaudeIO here. The registry lives outside setup's scope, so a reload can adopt its processes.
// Restart tests pass their own and close it, as an exiting opencode would.
export const make = (io: ClaudeIO.Interface, registry = ClaudeSessions.registry()) =>
  define({
    id: ID,
    effect: Effect.fn("ClaudeAgent.Plugin")(function* (ctx) {
      // Claude Agent runs the local `claude` binary, so skip it where opencode cannot start local processes.
      const environment = yield* Effect.serviceOption(Environment.Service)
      const location = yield* Effect.serviceOption(Location.Service)
      const remote = Option.isSome(environment)
        ? !environment.value.hostsServer || environment.value.spawner === EnvironmentUnavailable.spawner
        : Option.isSome(location) && location.value.workspaceID !== undefined
      if (remote) return

      const status = yield* ClaudeStatus.make(
        io,
        () => ClaudeProvider.connection(ctx),
        () => ClaudeProvider.configDirs(ctx),
      )
      const sessions = yield* registry.attach({ io, status, storage: ctx.storage, directory: ctx.location.directory })
      yield* ctx.event
        .subscribe({
          types: [
            "session.execution.succeeded",
            "session.execution.failed",
            "session.execution.interrupted",
            "session.deleted",
          ],
        })
        .pipe(
          Stream.runForEach((event) => {
            if (event.type !== "session.deleted") return sessions.idle(event.data.sessionID)
            return Effect.andThen(
              sessions.remove(event.data.sessionID),
              ctx.storage.remove(ClaudeAccounts.key(event.data.sessionID)),
            )
          }),
          Effect.forkScoped({ startImmediately: true }),
        )
      yield* ClaudeProvider.register(ctx, status, io)
      yield* ClaudeIntegration.register(ctx, status)
      yield* ClaudeAISDK.register(ctx, sessions)
      yield* ClaudeSessionHooks.register(ctx)
      yield* ClaudeInstructions.register(ctx)
      yield* ClaudeWebSearchProvider.register(ctx, io)
    }),
  } satisfies PluginInternal.InternalPlugin)

export const ClaudeAgentPlugin = make(ClaudeIO.real)
