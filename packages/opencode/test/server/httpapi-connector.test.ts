import { afterEach, describe, expect } from "bun:test"
import { Server } from "../../src/server/server"
import { Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

function app() {
  return Server.Default().app
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("connector HttpApi", () => {
  it.live(
    "reports disconnected status when no GitHub credential is stored",
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ config: { formatter: false, lsp: false } })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/connector/github/status", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toEqual({
        enabled: false,
        connected: false,
      })
    }),
  )

  it.live(
    "disconnect is idempotent when nothing is stored",
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ config: { formatter: false, lsp: false } })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/connector/github/disconnect", {
            method: "POST",
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toEqual({
        enabled: false,
        connected: false,
      })
    }),
  )
})
