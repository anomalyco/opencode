import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option } from "effect"
import { ClaudeIO } from "../../claude-agent/claude/io.js"
import { ClaudeSessions } from "../../claude-agent/claude/sessions.js"
import { ClaudeStatus } from "../../claude-agent/claude/status.js"
import { ClaudeAISDK } from "../../claude-agent/plugin/aisdk.js"
import { ClaudeInstructions } from "../../claude-agent/plugin/instructions.js"
import { ClaudeIntegration } from "../../claude-agent/plugin/integration.js"
import { ClaudeProvider } from "../../claude-agent/plugin/provider.js"
import { ClaudeSessionHooks } from "../../claude-agent/plugin/session.js"
import { Environment } from "../../environment/index.js"
import { EnvironmentUnavailable } from "../../environment/unavailable.js"
import { Location } from "../../location.js"
import type { PluginInternal } from "../internal.js"

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
      if (Option.isSome(location) && location.value.workspaceID !== undefined) return
      if (Option.isSome(environment) && environment.value.spawner === EnvironmentUnavailable.spawner) return

      const status = yield* ClaudeStatus.make(io)
      const sessions = yield* registry.attach({ io, status, storage: ctx.storage, directory: ctx.location.directory })
      yield* ClaudeProvider.register(ctx, status)
      yield* ClaudeIntegration.register(ctx, status)
      yield* ClaudeAISDK.register(ctx, sessions)
      yield* ClaudeSessionHooks.register(ctx)
      yield* ClaudeInstructions.register(ctx)
    }),
  } satisfies PluginInternal.InternalPlugin)

export const ClaudeAgentPlugin = make(ClaudeIO.real)
