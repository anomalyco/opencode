import { describe, expect, test } from "bun:test"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { Pty } from "../../src/pty"
import { tmpdir } from "../fixture/fixture"
import { setTimeout as sleep } from "node:timers/promises"

describe("pty", () => {
  test("does not leak output when websocket objects are reused", async () => {
    await using dir = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: dir.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            const a = yield* pty.create({ command: "cat", title: "a" })
            const b = yield* pty.create({ command: "cat", title: "b" })
            try {
              const outA: string[] = []
              const outB: string[] = []

              const ws = {
                readyState: 1,
                data: { events: { connection: "a" } },
                send: (data: unknown) => {
                  outA.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
                },
                close: () => {
                  // no-op (simulate abrupt drop)
                },
              }

              yield* pty.connect(a.id, ws as any)

              ws.data = { events: { connection: "b" } }
              ws.send = (data: unknown) => {
                outB.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
              }
              yield* pty.connect(b.id, ws as any)

              outA.length = 0
              outB.length = 0

              yield* pty.write(a.id, "AAA\n")
              yield* Effect.promise(() => sleep(100))

              expect(outB.join("")).not.toContain("AAA")
            } finally {
              yield* pty.remove(a.id)
              yield* pty.remove(b.id)
            }
          }),
        ),
    })
  })

  test("does not leak output when Bun recycles websocket objects before re-connect", async () => {
    await using dir = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: dir.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            const a = yield* pty.create({ command: "cat", title: "a" })
            try {
              const outA: string[] = []
              const outB: string[] = []

              const ws = {
                readyState: 1,
                data: { events: { connection: "a" } },
                send: (data: unknown) => {
                  outA.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
                },
                close: () => {
                  // no-op (simulate abrupt drop)
                },
              }

              yield* pty.connect(a.id, ws as any)
              outA.length = 0

              ws.data = { events: { connection: "b" } }
              ws.send = (data: unknown) => {
                outB.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
              }

              yield* pty.write(a.id, "AAA\n")
              yield* Effect.promise(() => sleep(100))

              expect(outB.join("")).not.toContain("AAA")
            } finally {
              yield* pty.remove(a.id)
            }
          }),
        ),
    })
  })

  test("treats in-place socket data mutation as the same connection", async () => {
    await using dir = await tmpdir({ git: true })

    await WithInstance.provide({
      directory: dir.path,
      fn: () =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const pty = yield* Pty.Service
            const a = yield* pty.create({ command: "cat", title: "a" })
            try {
              const out: string[] = []

              const ctx = { connId: 1 }
              const ws = {
                readyState: 1,
                data: ctx,
                send: (data: unknown) => {
                  out.push(typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8"))
                },
                close: () => {
                  // no-op
                },
              }

              yield* pty.connect(a.id, ws as any)
              out.length = 0

              ctx.connId = 2

              yield* pty.write(a.id, "AAA\n")
              yield* Effect.promise(() => sleep(100))

              expect(out.join("")).toContain("AAA")
            } finally {
              yield* pty.remove(a.id)
            }
          }),
        ),
    })
  })
})
