import { expect } from "bun:test"
import { Deferred, Effect, Exit } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Command } from "@opencode-ai/core/command"
import { Plugin } from "@opencode-ai/core/plugin"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

it.live("continues quarantine processing and cleanup after a plugin update observer fails", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    const bus = yield* Bus.Service
    const cleaned: string[] = []
    let fail = false
    let failPublication = true
    yield* plugins.activate(
      ["first", "second"].map((id) => ({
        id,
        revision: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Effect.sync(() => void cleaned.push(id)))
            yield* ctx.command.transform((editor) => {
              editor.add({ name: id, execute: () => Effect.void })
              if (fail) throw new Error(`${id} failed`)
            })
          }),
      })),
    )
    yield* Effect.acquireRelease(
      bus.listen((event) => {
        if (event.type !== Plugin.Event.Updated.type || !failPublication) return Effect.void
        failPublication = false
        return Effect.die("observer failed")
      }),
      (unsubscribe) => unsubscribe,
    )
    fail = true
    yield* commands.reload()
    const ready = yield* plugins.awaitActivation.pipe(Effect.timeout("250 millis"), Effect.exit)
    expect(Exit.isSuccess(ready)).toBe(true)
    expect((yield* plugins.list()).map((entry) => entry.state.status)).toEqual(["failed", "failed"])
    expect(cleaned.toSorted()).toEqual(["first", "second"])
    expect(yield* commands.list()).toEqual([])
  }),
)

it.live("settles readiness before shutdown joins a quarantined plugin's finalizers", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    const entered = yield* Deferred.make<void>()
    const escape = yield* Deferred.make<void>()
    const closed = yield* Deferred.make<void>()
    let fail = false
    yield* plugins.activate([
      {
        id: "closing",
        revision: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.command.transform((editor) => {
              editor.add({ name: "closing", execute: () => Effect.void })
              if (fail) throw new Error("closing failed")
            })
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(plugins.awaitActivation.pipe(Effect.raceFirst(Deferred.await(escape)))),
              ),
            )
          }),
      },
    ])
    fail = true
    yield* commands
      .reload()
      .pipe(
        Effect.andThen(plugins.close(Exit.void)),
        Effect.andThen(Deferred.succeed(closed, undefined)),
        Effect.forkChild({ startImmediately: true }),
      )
    yield* Deferred.await(entered)
    const result = yield* Deferred.await(closed).pipe(Effect.timeout("250 millis"), Effect.exit)
    // Release the fixture even on the old implementation, rather than hanging test teardown.
    yield* Deferred.succeed(escape, undefined)
    yield* Deferred.await(closed)
    expect(Exit.isSuccess(result)).toBe(true)
    const release = yield* plugins.hold()
    yield* plugins.awaitActivation
    let restarted = false
    yield* plugins.activate([
      { id: "after-close", revision: "1", effect: () => Effect.sync(() => void (restarted = true)) },
    ])
    yield* release
    expect(restarted).toBe(false)
  }),
)
