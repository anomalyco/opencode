import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { make, type Dependencies } from "./machine"

const scopes: Scope.Closeable[] = []

afterEach(async () => {
  await Promise.all(scopes.splice(0).map((scope) => Effect.runPromise(Scope.close(scope, Exit.void))))
})

// Drives the updater the way the app does: start or check, then install like a button click. `calls` records the platform
// operations in order; downloads record whether a differential download was allowed and installs record the staged
// version they would apply.
async function setup(input?: {
  currentVersion?: string
  ready?: { version: string }
  latest?: () => string
  install?: () => Promise<void>
  external?: boolean
}) {
  const calls: string[] = []
  const store = { ready: input?.ready }
  const dependencies: Dependencies = {
    currentVersion: input?.currentVersion ?? "1.0.0",
    platform: {
      checkForUpdate: Effect.try({
        try: () => {
          calls.push("check")
          const version = input?.latest?.() ?? "2.0.0"
          return input?.external
            ? { mode: "external" as const, version, url: `https://files.test/${version}.dmg` }
            : { mode: "restart" as const, version }
        },
        catch: (error) => error,
      }),
      stageUpdate: (options) =>
        Effect.sync(() => {
          calls.push(options.differential ? "download" : "download:full")
        }),
      installAndRestart: Effect.suspend(() => {
        calls.push(`install:${store.ready?.version}`)
        return Effect.tryPromise({
          try: () => input?.install?.() ?? new Promise<void>(() => {}),
          catch: (error) => error,
        })
      }),
      externalInstall: input?.external
        ? (url) =>
            Effect.sync(() => {
              calls.push(`external:${url}`)
            })
        : undefined,
    },
    restart: (handoff) =>
      Effect.suspend(() => {
        calls.push("prepare")
        return handoff
      }),
    persistence: {
      get: Effect.sync(() => store.ready),
      set: (value) =>
        Effect.sync(() => {
          store.ready = value
        }),
      clear: Effect.sync(() => {
        store.ready = undefined
      }),
    },
    changed: () => {},
  }
  const scope = Scope.makeUnsafe()
  scopes.push(scope)
  const updater = await Effect.runPromise(make(dependencies).pipe(Scope.provide(scope)))
  return {
    calls,
    getReady: () => store.ready,
    state: updater.state,
    start: () => Effect.runPromise(updater.started),
    check: () => Effect.runPromise(updater.check),
    install: () => Effect.runPromise(updater.install),
    installFork: () => Effect.runFork(updater.install),
  }
}

describe("updater", () => {
  test("revalidates a persisted target through the updater cache on launch without a differential download", async () => {
    const app = await setup({ ready: { version: "2.0.0" } })

    await app.start()

    expect(app.calls).toEqual(["check", "download:full"])
    expect(app.state()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("offers an external installer without staging or preparing to restart", async () => {
    const app = await setup({ external: true })

    await app.start()
    expect(app.calls).toEqual(["check"])
    expect(app.state()).toEqual({ status: "download-required", version: "2.0.0" })
    expect(app.getReady()).toBeUndefined()

    await app.install()
    expect(app.calls).toEqual(["check", "check", "external:https://files.test/2.0.0.dmg"])
    expect(app.state()).toEqual({ status: "download-required", version: "2.0.0" })
  })

  test("clicking install twice checks once and installs the staged version once", async () => {
    const app = await setup()
    await app.start()

    app.installFork()
    app.installFork()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(app.calls).toEqual(["check", "download", "check", "prepare", "install:2.0.0"])
    expect(app.state()).toEqual({ status: "installing", version: "2.0.0" })
  })

  test("returns to ready after a failed installation and allows a retry", async () => {
    const attempts = { count: 0 }
    const app = await setup({
      install() {
        attempts.count++
        if (attempts.count === 1) return Promise.reject(new Error("install failed"))
        return new Promise<void>(() => {})
      },
    })
    await app.start()

    await expect(app.install()).rejects.toThrow("install failed")
    expect(app.state()).toEqual({ status: "ready", version: "2.0.0" })

    app.installFork()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attempts.count).toBe(2)
    expect(app.state()).toEqual({ status: "installing", version: "2.0.0" })
  })
})
