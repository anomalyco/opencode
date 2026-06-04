import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
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

function waitGlobalConfigUpdated() {
  return waitGlobalBusEvent({
    message: "timed out waiting for global config update",
    predicate: (event) => event.payload.type === "global.config.updated" && event.directory === "global",
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
    "serves global config update as an incremental global event",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({})
      const previousConfigPath = Global.Path.config
      ;(Global.Path as { config: string }).config = tmp.path
      const configUpdated = yield* waitGlobalConfigUpdated().pipe(Effect.forkScoped)

      try {
        const response = yield* Effect.promise(() =>
          Promise.resolve(
            app().request("/global/config", {
              method: "PATCH",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({ username: "patched-global-user", formatter: false, lsp: false }),
            }),
          ),
        )

        expect(response.status).toBe(200)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          username: "patched-global-user",
          formatter: false,
          lsp: false,
        })
        const event = yield* Fiber.join(configUpdated)
        expect(event.payload.properties).toMatchObject({
          username: "patched-global-user",
          formatter: false,
          lsp: false,
        })
        expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "opencode.jsonc")).json())).toMatchObject({
          username: "patched-global-user",
          formatter: false,
          lsp: false,
        })
      } finally {
        ;(Global.Path as { config: string }).config = previousConfigPath
      }
    }),
  )

  it.live(
    "refreshes cached global config after an unchanged patch",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({})
      const previousConfigPath = Global.Path.config
      ;(Global.Path as { config: string }).config = tmp.path

      try {
        const first = yield* Effect.promise(() => Promise.resolve(app().request("/global/config")))
        expect(first.status).toBe(200)
        expect(yield* Effect.promise(() => first.json())).not.toMatchObject({
          username: "direct-file-user",
        })

        yield* Effect.promise(() =>
          Bun.write(path.join(tmp.path, "opencode.jsonc"), JSON.stringify({ username: "direct-file-user" })),
        )

        const refresh = yield* Effect.promise(() =>
          Promise.resolve(
            app().request("/global/config", {
              method: "PATCH",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({}),
            }),
          ),
        )
        expect(refresh.status).toBe(200)
        expect(yield* Effect.promise(() => refresh.json())).toMatchObject({
          username: "direct-file-user",
        })

        const second = yield* Effect.promise(() => Promise.resolve(app().request("/global/config")))
        expect(second.status).toBe(200)
        expect(yield* Effect.promise(() => second.json())).toMatchObject({
          username: "direct-file-user",
        })
      } finally {
        ;(Global.Path as { config: string }).config = previousConfigPath
      }
    }),
  )

  it.live(
    "refreshes provider list after global provider config changes",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({})
      const previousConfigPath = Global.Path.config
      ;(Global.Path as { config: string }).config = tmp.path

      try {
        const first = yield* Effect.promise(() =>
          Promise.resolve(
            app().request("/provider", {
              headers: {
                "x-opencode-directory": tmp.path,
              },
            }),
          ),
        )
        expect(first.status).toBe(200)
        const initial = (yield* Effect.promise(() => first.json())) as { all: Array<{ id: string }> }
        const providerID = initial.all[0]?.id
        expect(typeof providerID).toBe("string")
        if (!providerID) throw new Error("expected at least one provider")

        const update = yield* Effect.promise(() =>
          Promise.resolve(
            app().request("/global/config", {
              method: "PATCH",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({ disabled_providers: [providerID] }),
            }),
          ),
        )
        expect(update.status).toBe(200)

        const second = yield* Effect.promise(() =>
          Promise.resolve(
            app().request("/provider", {
              headers: {
                "x-opencode-directory": tmp.path,
              },
            }),
          ),
        )
        expect(second.status).toBe(200)
        const refreshed = (yield* Effect.promise(() => second.json())) as { all: Array<{ id: string }> }
        expect(refreshed.all.some((provider) => provider.id === providerID)).toBe(false)
      } finally {
        ;(Global.Path as { config: string }).config = previousConfigPath
      }
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
