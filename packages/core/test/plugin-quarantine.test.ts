import { expect } from "bun:test"
import { Deferred, Effect, Exit } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Command } from "@opencode-ai/core/command"
import { Plugin } from "@opencode-ai/core/plugin"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

Array.of("reload", "teardown").forEach((boundary) =>
  it.live(`does not join queued quarantine cleanup during ${boundary}`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const commands = yield* Command.Service
      const entered = yield* Deferred.make<void>()
      const escape = yield* Deferred.make<void>()
      const activated = yield* Deferred.make<void>()
      const cleaned = yield* Deferred.make<void>()
      let fail = false
      yield* plugins.activate([
        {
          id: "changing",
          revision: "1",
          effect: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.command.transform((editor) => {
                editor.add({ name: "changing", description: "old", execute: () => Effect.void })
                if (fail) throw new Error("changing failed")
              })
              yield* Effect.addFinalizer(() =>
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(plugins.awaitActivation.pipe(Effect.raceFirst(Deferred.await(escape)))),
                  Effect.andThen(Deferred.succeed(cleaned, undefined)),
                ),
              )
            }),
        },
        {
          id: "trigger",
          revision: "1",
          effect: () =>
            Effect.addFinalizer(() =>
              boundary === "teardown"
                ? commands.reload().pipe(Effect.andThen(commands.list()), Effect.asVoid)
                : Effect.void,
            ),
        },
      ])
      fail = true
      yield* (boundary === "reload" ? commands.reload() : Effect.void).pipe(
        Effect.andThen(
          plugins.activate([
            {
              id: "changing",
              revision: "2",
              effect: (ctx) =>
                ctx.command
                  .transform((editor) =>
                    editor.add({ name: "changing", description: "new", execute: () => Effect.void }),
                  )
                  .pipe(Effect.asVoid),
            },
          ]),
        ),
        Effect.andThen(Deferred.succeed(activated, undefined)),
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.await(entered)
      const result = yield* Deferred.await(activated).pipe(Effect.timeout("250 millis"), Effect.exit)
      // Allow teardown to finish even if activation incorrectly joins the old finalizer.
      yield* Deferred.succeed(escape, undefined)
      yield* Deferred.await(activated)
      yield* plugins.awaitActivation
      yield* Deferred.await(cleaned)
      expect(Exit.isSuccess(result)).toBe(true)
      expect((yield* plugins.list())[0]?.state).toEqual({ status: "active" })
      expect(yield* commands.get("changing")).toMatchObject({ description: "new" })
    }),
  ),
)

it.live("does not restore a queued quarantined generation when its replacement fails setup", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const commands = yield* Command.Service
    const loads: string[] = []
    let fail = false
    const generation = (revision: string): Plugin.Generation => ({
      id: "replacement",
      revision,
      effect: (ctx) =>
        Effect.gen(function* () {
          loads.push(revision)
          if (revision === "2") yield* Effect.die("setup failed")
          yield* ctx.command.transform((editor) => {
            editor.add({ name: "replacement", execute: () => Effect.void })
            if (fail) throw new Error("replay failed")
          })
        }),
    })
    yield* plugins.activate([generation("1")])
    fail = true
    yield* commands.reload()
    yield* plugins.activate([generation("2")])
    yield* plugins.awaitActivation
    expect(loads).toEqual(["1", "2"])
    expect((yield* plugins.list())[0]?.state.status).toBe("failed")
    expect(yield* commands.get("replacement")).toBeUndefined()
  }),
)

Array.of("pending", "reported").forEach((status) =>
  it.live(`preserves ${status} quarantine when an earlier plugin changes`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const commands = yield* Command.Service
      const loads: string[] = []
      let fail = true
      const generation = (id: string, revision: string): Plugin.Generation => ({
        id,
        revision,
        effect: (ctx) =>
          Effect.gen(function* () {
            loads.push(`${id}@${revision}`)
            yield* ctx.command.transform((editor) => {
              editor.add({ name: id, execute: () => Effect.void })
              if (id === "broken" && fail) throw new Error("broken failed")
            })
          }),
      })
      const broken = generation("broken", "1")
      const later = generation("later", "1")
      yield* plugins.activate([generation("earlier", "1"), broken, later])
      if (status === "reported") yield* plugins.awaitActivation
      fail = false
      yield* plugins.activate([generation("earlier", "2"), broken, later])
      yield* plugins.awaitActivation
      expect(loads).toEqual(["earlier@1", "broken@1", "later@1", "earlier@2", "later@1"])
      const failed = (yield* plugins.list())[1]?.state
      expect(failed).toMatchObject({ status: "failed", ref: expect.stringMatching(/^err_/) })
      expect((yield* commands.list()).map((entry) => entry.name)).toEqual(["earlier", "later"])

      // Reordering and removing other plugins must preserve the same failure too.
      yield* plugins.activate([later, broken, generation("earlier", "2")])
      yield* plugins.awaitActivation
      expect((yield* plugins.list())[1]?.state).toEqual(failed)
      expect((yield* commands.list()).map((entry) => entry.name)).toEqual(["later", "earlier"])
      yield* plugins.activate([broken, later])
      yield* plugins.awaitActivation
      expect((yield* plugins.list())[0]?.state).toEqual(failed)
      expect(loads.filter((entry) => entry === "broken@1")).toHaveLength(1)

      yield* plugins.activate([generation("broken", "2"), later])
      yield* plugins.awaitActivation
      expect((yield* plugins.list())[0]?.state).toEqual({ status: "active" })
      expect(yield* commands.get("broken")).toBeDefined()
      expect(loads.filter((entry) => entry === "broken@2")).toHaveLength(1)
    }),
  ),
)

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
