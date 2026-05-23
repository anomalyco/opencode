import { describe, expect } from "bun:test"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Plugin } from "../../src/plugin"
import { Pty } from "../../src/pty"
import type { PtyID } from "../../src/pty/schema"
import { Cause, Effect, Exit, Layer, Queue } from "effect"
import { testEffect } from "../lib/effect"

type PtyEvent = { type: "created" | "exited" | "deleted"; id: PtyID }

const it = testEffect(
  Pty.layer.pipe(
    Layer.provideMerge(Bus.layer),
    Layer.provideMerge(Config.defaultLayer),
    Layer.provideMerge(Plugin.defaultLayer),
  ),
)
const ptyTest = process.platform === "win32" ? it.instance.skip : it.instance

const subscribePtyEvents = Effect.fn("PtySessionTest.subscribePtyEvents")(function* () {
  const bus = yield* Bus.Service
  const events = yield* Queue.unbounded<PtyEvent>()

  const subscribe = <A>(effect: Effect.Effect<() => void, never, A>) =>
    Effect.acquireRelease(effect, (off) => Effect.sync(off))

  yield* subscribe(
    bus.subscribeCallback(Pty.Event.Created, (evt) => {
      Queue.offerUnsafe(events, { type: "created", id: evt.properties.info.id })
    }),
  )
  yield* subscribe(
    bus.subscribeCallback(Pty.Event.Exited, (evt) => {
      Queue.offerUnsafe(events, { type: "exited", id: evt.properties.id })
    }),
  )
  yield* subscribe(
    bus.subscribeCallback(Pty.Event.Deleted, (evt) => {
      Queue.offerUnsafe(events, { type: "deleted", id: evt.properties.id })
    }),
  )

  return events
})

const createPty = Effect.fn("PtySessionTest.createPty")(function* (input: Pty.CreateInput) {
  const pty = yield* Pty.Service
  return yield* Effect.acquireRelease(pty.create(input), (info) => pty.remove(info.id).pipe(Effect.ignore))
})

const waitForEvents = (events: Queue.Queue<PtyEvent>, id: PtyID, count: number) => {
  return Effect.gen(function* () {
    const picked: Array<PtyEvent["type"]> = []
    while (picked.length < count) {
      const evt = yield* Queue.take(events)
      if (evt.id === id) picked.push(evt.type)
    }
    return picked
  }).pipe(
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(new Error("timeout waiting for pty events")),
    }),
  )
}

describe("pty", () => {
  it.instance(
    "returns typed not found errors for missing sessions",
    () =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        const id = "pty_missing" as PtyID
        let closed = false
        const socket = {
          readyState: 1,
          send: () => {},
          close: () => {
            closed = true
          },
        }

        const get = yield* pty.get(id).pipe(Effect.exit)
        expect(Exit.isFailure(get)).toBe(true)
        if (Exit.isFailure(get)) expect(Cause.squash(get.cause)).toMatchObject({ _tag: "Pty.NotFoundError", ptyID: id })

        const update = yield* pty.update(id, { title: "missing" }).pipe(Effect.exit)
        expect(Exit.isFailure(update)).toBe(true)
        if (Exit.isFailure(update))
          expect(Cause.squash(update.cause)).toMatchObject({ _tag: "Pty.NotFoundError", ptyID: id })

        const remove = yield* pty.remove(id).pipe(Effect.exit)
        expect(Exit.isFailure(remove)).toBe(true)
        if (Exit.isFailure(remove))
          expect(Cause.squash(remove.cause)).toMatchObject({ _tag: "Pty.NotFoundError", ptyID: id })

        const resize = yield* pty.resize(id, 80, 24).pipe(Effect.exit)
        expect(Exit.isFailure(resize)).toBe(true)
        if (Exit.isFailure(resize))
          expect(Cause.squash(resize.cause)).toMatchObject({ _tag: "Pty.NotFoundError", ptyID: id })

        const write = yield* pty.write(id, "input").pipe(Effect.exit)
        expect(Exit.isFailure(write)).toBe(true)
        if (Exit.isFailure(write))
          expect(Cause.squash(write.cause)).toMatchObject({ _tag: "Pty.NotFoundError", ptyID: id })

        const connect = yield* pty.connect(id, socket).pipe(Effect.exit)
        expect(Exit.isFailure(connect)).toBe(true)
        if (Exit.isFailure(connect))
          expect(Cause.squash(connect.cause)).toMatchObject({ _tag: "Pty.NotFoundError", ptyID: id })
        expect(closed).toBe(true)
      }),
    { git: true },
  )

  ptyTest(
    "publishes created, exited, deleted in order for a short-lived process",
    () =>
      Effect.gen(function* () {
        const events = yield* subscribePtyEvents()
        const info = yield* createPty({
          command: "/usr/bin/env",
          args: ["sh", "-c", "sleep 0.1"],
          title: "sleep",
        })

        expect(yield* waitForEvents(events, info.id, 3)).toEqual(["created", "exited", "deleted"])
      }),
    { git: true },
  )

  ptyTest(
    "publishes created, exited, deleted in order for /bin/sh + remove",
    () =>
      Effect.gen(function* () {
        const pty = yield* Pty.Service
        const events = yield* subscribePtyEvents()
        const info = yield* createPty({ command: "/bin/sh", title: "sh" })

        expect(yield* waitForEvents(events, info.id, 1)).toEqual(["created"])
        yield* pty.write(info.id, "exit\n")
        expect(yield* waitForEvents(events, info.id, 2)).toEqual(["exited", "deleted"])
        yield* pty.remove(info.id).pipe(Effect.ignore)
      }),
    { git: true },
  )
})
