import { describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Bus } from "../../src/bus"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import type { PtyID } from "../../src/pty/schema"
import { tmpdir } from "../fixture/fixture"
import { setTimeout as sleep } from "node:timers/promises"

const wait = async (fn: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return
    await sleep(25)
  }
  throw new Error("timeout waiting for pty events")
}

const pick = (log: Array<{ type: "created" | "exited" | "deleted"; id: PtyID }>, id: PtyID) => {
  return log.filter((evt) => evt.id === id).map((evt) => evt.type)
}

describe("pty", () => {
  test("publishes created, exited, deleted in order for a short-lived process", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            const log: Array<{ type: "created" | "exited" | "deleted"; id: PtyID }> = []
            const off = [
              Bus.subscribe(Pty.Event.Created, (evt) => log.push({ type: "created", id: evt.properties.info.id })),
              Bus.subscribe(Pty.Event.Exited, (evt) => log.push({ type: "exited", id: evt.properties.id })),
              Bus.subscribe(Pty.Event.Deleted, (evt) => log.push({ type: "deleted", id: evt.properties.id })),
            ]

            let id: PtyID | undefined
            try {
              const info = yield* pty.create({
                command: "/usr/bin/env",
                args: ["sh", "-c", "sleep 0.1"],
                title: "sleep",
              })
              id = info.id

              yield* Effect.promise(() => wait(() => pick(log, id!).includes("exited")))

              yield* pty.remove(id)
              yield* Effect.promise(() => wait(() => pick(log, id!).length >= 3))
              expect(pick(log, id!)).toEqual(["created", "exited", "deleted"])
            } finally {
              off.forEach((x) => x())
              if (id) yield* pty.remove(id)
            }
          }),
        ),
    })
  })

  test("publishes created, exited, deleted in order for /bin/sh + remove", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            const log: Array<{ type: "created" | "exited" | "deleted"; id: PtyID }> = []
            const off = [
              Bus.subscribe(Pty.Event.Created, (evt) => log.push({ type: "created", id: evt.properties.info.id })),
              Bus.subscribe(Pty.Event.Exited, (evt) => log.push({ type: "exited", id: evt.properties.id })),
              Bus.subscribe(Pty.Event.Deleted, (evt) => log.push({ type: "deleted", id: evt.properties.id })),
            ]

            let id: PtyID | undefined
            try {
              const info = yield* pty.create({ command: "/bin/sh", title: "sh" })
              id = info.id

              yield* Effect.promise(() => sleep(100))

              yield* pty.remove(id)
              yield* Effect.promise(() => wait(() => pick(log, id!).length >= 3))
              expect(pick(log, id!)).toEqual(["created", "exited", "deleted"])
            } finally {
              off.forEach((x) => x())
              if (id) yield* pty.remove(id)
            }
          }),
        ),
    })
  })
})
