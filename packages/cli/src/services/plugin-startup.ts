import type { OpenCodeClient } from "@opencode/client"
import { Effect, Schedule } from "effect"

// Catalog reads return whatever is loaded, and a cold Location lists no plugins until its first activation.
// One-shot commands read once and exit, so they give that activation a moment before reading.
export const waitForPlugins = (client: OpenCodeClient, directory: string) => {
  const list = Effect.tryPromise((signal) => client.plugin.list({ location: { directory } }, { signal }))
  return list.pipe(
    Effect.flatMap((plugins) =>
      plugins.data.length > 0
        ? Effect.void
        : Effect.sleep("25 millis").pipe(
            Effect.andThen(
              list.pipe(
                Effect.repeat({
                  until: (next) => next.data.length > 0,
                  schedule: Schedule.spaced("25 millis").pipe(Schedule.upTo({ duration: "15 seconds" })),
                }),
              ),
            ),
            Effect.asVoid,
          ),
    ),
    Effect.ignore,
  )
}
