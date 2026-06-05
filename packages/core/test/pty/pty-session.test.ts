import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Queue } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { Pty } from "@opencode-ai/core/pty"
import type { PtyID } from "@opencode-ai/core/pty/schema"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"

type PtyEvent = { type: "created" | "exited" | "deleted"; id: PtyID }

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/tmp") })),
)
const it = testEffect(Pty.layer.pipe(Layer.provideMerge(EventV2.defaultLayer), Layer.provideMerge(locationLayer)))
const ptyTest = process.platform === "win32" ? it.live.skip : it.live

const subscribePtyEvents = Effect.fn("PtySessionTest.subscribePtyEvents")(function* () {
  const source = yield* EventV2.Service
  const events = yield* Queue.unbounded<PtyEvent>()
  const unsubscribe = yield* source.listen((event) => {
    if (event.type === Pty.Event.Created.type)
      Queue.offerUnsafe(events, { type: "created", id: (event.data as typeof Pty.Event.Created.data.Type).info.id })
    if (event.type === Pty.Event.Exited.type)
      Queue.offerUnsafe(events, { type: "exited", id: (event.data as typeof Pty.Event.Exited.data.Type).id })
    if (event.type === Pty.Event.Deleted.type)
      Queue.offerUnsafe(events, { type: "deleted", id: (event.data as typeof Pty.Event.Deleted.data.Type).id })
    return Effect.void
  })
  yield* Effect.addFinalizer(() => unsubscribe)
  return events
})

const createPty = Effect.fn("PtySessionTest.createPty")(function* (command: string, args: string[] = []) {
  const pty = yield* Pty.Service
  return yield* Effect.acquireRelease(
    pty.create({ command, args, cwd: "/tmp", env: { TERM: "xterm-256color", OPENCODE_TERMINAL: "1" } }),
    (info) => pty.remove(info.id).pipe(Effect.ignore),
  )
})

const waitForEvents = (events: Queue.Queue<PtyEvent>, id: PtyID, count: number) =>
  Effect.gen(function* () {
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

describe("pty", () => {
  it.live("returns typed not found errors for missing sessions", () =>
    Effect.gen(function* () {
      const pty = yield* Pty.Service
      const id = "pty_missing" as PtyID
      let closed = false
      const socket = { readyState: 1, send: () => {}, close: () => void (closed = true) }

      for (const result of [
        yield* pty.get(id).pipe(Effect.asVoid, Effect.exit),
        yield* pty.update(id, { title: "missing" }).pipe(Effect.asVoid, Effect.exit),
        yield* pty.remove(id).pipe(Effect.exit),
        yield* pty.resize(id, 80, 24).pipe(Effect.exit),
        yield* pty.write(id, "input").pipe(Effect.exit),
        yield* pty.connect(id, socket).pipe(Effect.asVoid, Effect.exit),
      ]) {
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result))
          expect(Cause.squash(result.cause)).toMatchObject({ _tag: "Pty.NotFoundError", ptyID: id })
      }
      expect(closed).toBe(true)
    }),
  )

  ptyTest("publishes created, exited, deleted in order for a short-lived process", () =>
    Effect.gen(function* () {
      const events = yield* subscribePtyEvents()
      const info = yield* createPty("/usr/bin/env", ["sh", "-c", "sleep 0.1"])

      expect(yield* waitForEvents(events, info.id, 3)).toEqual(["created", "exited", "deleted"])
    }),
  )
})
