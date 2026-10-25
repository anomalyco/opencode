import { expect, test } from "bun:test"
import { Effect } from "effect"
import type { LogEntry } from "../src/logging"
import { layer } from "../src/logging"

test("maps Effect log levels to SDK log levels", async () => {
  const entries: LogEntry[] = []
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.logTrace("trace")
      yield* Effect.logDebug("debug")
      yield* Effect.logInfo("info")
      yield* Effect.logWarning("warn")
      yield* Effect.logError("error")
      yield* Effect.logFatal("fatal")
    }).pipe(Effect.provide(layer({ level: "trace", emit: (entry) => entries.push(entry) }))),
  )

  expect(entries.map((entry) => entry.level)).toEqual(["trace", "debug", "info", "warn", "error", "fatal"])
})
