import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

function waitDisposed(directory: string) {
  return waitGlobalBusEvent({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
  })
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  it.live(
    "serves config update through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped)

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
    }),
  )

  it.live(
    "serves config with active provider model status",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            omniroute: {
              models: {
                "gpt-4o": {
                  status: "active",
                },
              },
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        provider: {
          omniroute: {
            models: {
              "gpt-4o": {
                status: "active",
              },
            },
          },
        },
      })
    }),
  )

  it.live(
    "reloads workspace config through the project reload endpoint",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { username: "before", formatter: false, lsp: false } })

      const before = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: { "x-opencode-directory": tmp.path },
          }),
        ),
      )
      expect(before.status).toBe(200)
      expect(yield* Effect.promise(() => before.json())).toMatchObject({ username: "before" })

      const current = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/project/current", {
            headers: { "x-opencode-directory": tmp.path },
          }),
        ),
      )
      expect(current.status).toBe(200)

      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, "opencode.json"),
          JSON.stringify({ $schema: "https://opencode.ai/config.json", username: "after", formatter: false, lsp: false }),
        ),
      )

      const reload = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/project/reload", {
            method: "POST",
            headers: { "x-opencode-directory": tmp.path },
          }),
        ),
      )
      expect(reload.status).toBe(200)
      expect(yield* Effect.promise(() => reload.json())).toBe(true)

      const after = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: { "x-opencode-directory": tmp.path },
          }),
        ),
      )
      expect(after.status).toBe(200)
      expect(yield* Effect.promise(() => after.json())).toMatchObject({ username: "after" })
    }),
  )
})
