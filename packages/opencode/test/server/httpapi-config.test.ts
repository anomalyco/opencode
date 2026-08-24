import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Server } from "../../src/server/server"
import { Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"

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
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped({ startImmediately: true }))

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
      // The PATCH must persist to the project config file the loader reads,
      // never the legacy config.json that is ignored on reload.
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "opencode.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).exists())).toBe(false)
    }),
  )

  it.live(
    "persists config update to the .opencode project config",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        init: async (dir) => {
          await fs.mkdir(path.join(dir, ".opencode"))
          await Bun.write(
            path.join(dir, ".opencode", "opencode.json"),
            JSON.stringify(
              { $schema: "https://opencode.ai/config.json", username: "e2e-user", formatter: true },
              null,
              2,
            ),
          )
        },
      })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped({ startImmediately: true }))

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ username: "patched-user", formatter: false }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      yield* Fiber.join(disposed)
      // The mutation must be persisted to the .opencode config the loader
      // reads last, not to a plain opencode.json or legacy config.json.
      const written = yield* Effect.promise(() => Bun.file(path.join(tmp.path, ".opencode", "opencode.json")).json())
      expect(written).toMatchObject({ username: "patched-user", formatter: false })
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "opencode.json")).exists())).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).exists())).toBe(false)

      const getResponse = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )
      expect(getResponse.status).toBe(200)
      expect(yield* Effect.promise(() => getResponse.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
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
})
