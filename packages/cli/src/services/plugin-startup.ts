import type { OpenCodeClient } from "@opencode/client"
import { Effect, Schedule } from "effect"

// Catalog reads return whatever is loaded, and a cold Location lists no plugins until its first activation.
// One-shot commands read once and exit, so they give that activation a moment before reading.
export const waitForPlugins = (client: OpenCodeClient, directory: string) =>
  Effect.tryPromise((signal) => client.plugin.list({ location: { directory } }, { signal })).pipe(
    Effect.repeat({
      until: (plugins) => plugins.data.length > 0,
      schedule: Schedule.spaced("25 millis").pipe(Schedule.upTo({ duration: "5 seconds" })),
    }),
    Effect.ignore,
  )
