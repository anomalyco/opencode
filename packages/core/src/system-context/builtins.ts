export * as SystemContextBuiltIns from "./builtins"

import { DateTime, Duration, Effect, Layer, Schema, Option } from "effect"
import { Location } from "../location"
import { SystemContext } from "./index"
import { InstructionContext } from "../instruction-context"
import { SystemContextRegistry } from "./registry"
import { Service as MemoryService, layer as MemoryLayer } from "../memory/service"
import { Service as ConfigService, latest } from "../config"

const builtIns = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    const memoryOpt = yield* Effect.serviceOption(MemoryService)
    const configOpt = yield* Effect.serviceOption(ConfigService)
    const environment = [
      "<env>",
      `  Working directory: ${location.directory}`,
      `  Workspace root folder: ${location.project.directory}`,
      `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      "</env>",
    ].join("\n")
    const dateLoad = yield* Effect.cachedWithTTL(
      DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
      Duration.minutes(15),
    )
    const context = SystemContext.combine([
      SystemContext.make({
        key: SystemContext.Key.make("core/environment"),
        codec: Schema.toCodecJson(Schema.String),
        load: Effect.succeed(environment),
        baseline: (environment) =>
          ["Here is some useful information about the environment you are running in:", environment].join("\n"),
        update: (_previous, environment) => ["The environment you are running in is now:", environment].join("\n"),
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/date"),
        codec: Schema.toCodecJson(Schema.String),
        load: dateLoad,
        baseline: (date) => `Today's date: ${date}`,
        update: (_previous, date) => `Today's date is now: ${date}`,
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/memory"),
        codec: Schema.toCodecJson(Schema.Array(Schema.String)),
        load: Option.match(memoryOpt, {
          onNone: () => Effect.succeed([] as string[]),
          onSome: (memory) =>
            memory.recall("", 10).pipe(
              Effect.map((entries) => entries.map((e) => e.content)),
              Effect.catch(() => Effect.succeed([] as string[])),
            ),
        }),
        baseline: (memories) =>
          memories.length > 0
            ? [
                "Here are some facts, preferences, and instructions from your long-term memory:",
                ...memories.map((m) => `- ${m}`),
              ].join("\n")
            : "No previous facts or instructions in long-term memory.",
        update: (_previous, memories) =>
          memories.length > 0
            ? [
                "Your long-term memories have updated:",
                ...memories.map((m) => `- ${m}`),
              ].join("\n")
            : "No long-term memories active.",
      }),
      SystemContext.make({
        key: SystemContext.Key.make("core/profile"),
        codec: Schema.toCodecJson(Schema.Struct({
          user_name: Schema.optional(Schema.String),
          assistant_persona: Schema.optional(Schema.String),
          timezone: Schema.optional(Schema.String),
        })),
        load: Option.match(configOpt, {
          onNone: () => Effect.succeed({ user_name: undefined, assistant_persona: undefined, timezone: undefined }),
          onSome: (config) =>
            config.entries().pipe(
              Effect.map((entries) => {
                const profile = latest(entries, "personal_profile")
                return {
                  user_name: profile?.user_name,
                  assistant_persona: profile?.assistant_persona,
                  timezone: profile?.timezone,
                }
              }),
            ),
        }),
        baseline: (profile) => {
          const lines = ["User Profile:"]
          if (profile.user_name) lines.push(`  User Name: ${profile.user_name}`)
          if (profile.assistant_persona) lines.push(`  Assistant Persona: ${profile.assistant_persona}`)
          if (profile.timezone) lines.push(`  Timezone: ${profile.timezone}`)
          return lines.length > 1 ? lines.join("\n") : "No user profile details configured."
        },
        update: (_previous, profile) => {
          const lines = ["User Profile Updated:"]
          if (profile.user_name) lines.push(`  User Name: ${profile.user_name}`)
          if (profile.assistant_persona) lines.push(`  Assistant Persona: ${profile.assistant_persona}`)
          if (profile.timezone) lines.push(`  Timezone: ${profile.timezone}`)
          return lines.length > 1 ? lines.join("\n") : "No user profile details configured."
        },
      }),
    ])

    yield* registry.register({ key: SystemContext.Key.make("core/builtins"), load: Effect.succeed(context) })
  }),
)

export const layer = Layer.mergeAll(builtIns, InstructionContext.layer).pipe(
  Layer.provideMerge(SystemContextRegistry.layer),
)

export const locationLayer = layer
