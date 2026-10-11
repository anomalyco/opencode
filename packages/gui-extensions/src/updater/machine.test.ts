import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import type { UpdaterState } from "./contract"
import { make, type Dependencies } from "./machine"

const scopes: Scope.Closeable[] = []

afterEach(async () => {
  await Promise.all(scopes.splice(0).map((scope) => Effect.runPromise(Scope.close(scope, Exit.void))))
})

// Drives the updater the way the app does: start or check, then install like a button click. `calls` records the platform
// operations in order; downloads record whether a differential download was allowed and installs record the staged
// version they would apply. `seen` records every state the updater published.
async function setup(input?: {
  currentVersion?: string
  ready?: { version: string }
  /** The release each platform check finds, in order; the last one repeats. "offline" fails the check. */
  checks?: readonly string[]
  stage?: () => Promise<void>
  install?: () => Promise<void>
  external?: boolean
  open?: () => Promise<void>
}) {
  const calls: string[] = []
  const seen: UpdaterState[] = []
  const store = { ready: input?.ready }
  const checks = input?.checks ?? ["2.0.0"]
  const cursor = { check: 0 }

  const dependencies: Dependencies = {
    currentVersion: input?.currentVersion ?? "1.0.0",
    platform: {
      checkForUpdate: Effect.try({
        try: () => {
          calls.push("check")
          const version = checks[Math.min(cursor.check++, checks.length - 1)] ?? "2.0.0"

          if (version === "offline") throw new Error("offline")

          return input?.external
            ? { mode: "external" as const, version, url: `https://files.test/${version}.dmg` }
            : { mode: "restart" as const, version }
        },
        catch: (error) => error,
      }),
      stageUpdate: (options) =>
        Effect.tryPromise(async () => {
          calls.push(options.differential ? "download" : "download:full")
          await input?.stage?.()
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
            Effect.tryPromise(async () => {
              calls.push(`external:${url}`)
              await input.open?.()
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
    changed: (state) => seen.push(state),
  }

  const scope = Scope.makeUnsafe()
  scopes.push(scope)
  const updater = await Effect.runPromise(make(dependencies).pipe(Scope.provide(scope)))

  return {
    calls,
    seen,
    getReady: () => store.ready,
    state: updater.state,
    start: () => Effect.runPromise(updater.started),
    check: () => Effect.runPromise(updater.check),
    install: () => Effect.runPromise(updater.install),
    installFork: () => Effect.runFork(updater.install),
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("updater", () => {
  // The launch check, then one silent re-check per further entry in `checks`. `rechecks` lists the states the
  // re-checks published: a ready or offered update never leaves the screen while one runs.
  test.each([
    {
      name: "revalidates a persisted target through the updater cache on launch without a differential download",
      input: { ready: { version: "2.0.0" }, checks: ["2.0.0"] },
      calls: ["check", "download:full"],
      state: { status: "ready", version: "2.0.0" },
      ready: { version: "2.0.0" },
      rechecks: [],
    },
    {
      name: "reports up to date and clears the record once the update is installed",
      input: { currentVersion: "2.0.0", ready: { version: "2.0.0" }, checks: ["2.0.0"] },
      calls: ["check"],
      state: { status: "up-to-date" },
      ready: undefined,
      rechecks: [],
    },
    {
      name: "keeps differential downloads after the persisted target was installed",
      input: { currentVersion: "2.0.0", ready: { version: "2.0.0" }, checks: ["3.0.0"] },
      calls: ["check", "download"],
      state: { status: "ready", version: "3.0.0" },
      ready: { version: "3.0.0" },
      rechecks: [],
    },
    {
      name: "downloads newer releases in full once one is staged",
      input: { checks: ["2.0.0", "3.0.0"] },
      calls: ["check", "download", "check", "download:full"],
      state: { status: "ready", version: "3.0.0" },
      ready: { version: "3.0.0" },
      rechecks: [{ status: "ready", version: "3.0.0" }],
    },
    {
      name: "later checks stay silent while ready and pick up newer versions",
      input: { checks: ["2.0.0", "2.0.0", "3.0.0"] },
      calls: ["check", "download", "check", "check", "download:full"],
      state: { status: "ready", version: "3.0.0" },
      ready: { version: "3.0.0" },
      rechecks: [{ status: "ready", version: "3.0.0" }],
    },
    {
      name: "keeps the staged update installable when a silent re-check fails",
      input: { checks: ["2.0.0", "offline"] },
      calls: ["check", "download", "check"],
      state: { status: "ready", version: "2.0.0" },
      ready: { version: "2.0.0" },
      rechecks: [],
    },
    {
      name: "offers an external installer when its version equals the running beta",
      input: { currentVersion: "2.0.0", external: true, checks: ["2.0.0"] },
      calls: ["check"],
      state: { status: "download-required", version: "2.0.0" },
      ready: undefined,
      rechecks: [],
    },
    {
      name: "keeps an external installer available when a refresh fails",
      input: { external: true, checks: ["2.0.0", "offline"] },
      calls: ["check", "check"],
      state: { status: "download-required", version: "2.0.0" },
      ready: undefined,
      rechecks: [],
    },
  ])("$name", async (row) => {
    const app = await setup(row.input)
    await app.start()
    const launched = app.seen.length

    await row.input.checks.slice(1).reduce<Promise<unknown>>((chain) => chain.then(app.check), Promise.resolve())

    expect(app.calls).toEqual([...row.calls])
    expect(app.state()).toEqual(row.state)
    expect(app.getReady()).toEqual(row.ready)
    expect(app.seen.slice(launched)).toEqual([...row.rechecks])
  })

  // After launch staged 2.0.0, a click shows it installing at once; `then` is a second action right after the click.
  test.each([
    {
      name: "clicking install twice checks once and installs the staged version once",
      checks: ["2.0.0"],
      then: "install",
      calls: ["check", "download", "check", "prepare", "install:2.0.0"],
      state: { status: "installing", version: "2.0.0" },
    },
    {
      name: "ignores checks while an installation is in progress",
      checks: ["2.0.0"],
      then: "check",
      calls: ["check", "download", "check", "prepare", "install:2.0.0"],
      state: { status: "installing", version: "2.0.0" },
    },
    {
      name: "clicking install downloads and installs a newer release",
      checks: ["2.0.0", "3.0.0"],
      then: undefined,
      calls: ["check", "download", "check", "download:full", "prepare", "install:3.0.0"],
      state: { status: "installing", version: "3.0.0" },
    },
    {
      name: "clicking install uses the staged release when the final check fails",
      checks: ["2.0.0", "offline"],
      then: undefined,
      calls: ["check", "download", "check", "prepare", "install:2.0.0"],
      state: { status: "installing", version: "2.0.0" },
    },
  ])("$name", async (row) => {
    const app = await setup({ checks: row.checks })
    await app.start()

    app.installFork()
    expect(app.state()).toEqual({ status: "installing", version: "2.0.0" })

    if (row.then === "install") app.installFork()

    if (row.then === "check") await app.check()
    await tick()

    expect(app.calls).toEqual([...row.calls])
    expect(app.state()).toEqual(row.state)
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

  test("opens an external installer once for concurrent clicks", async () => {
    const opened = Promise.withResolvers<void>()
    const app = await setup({ external: true, open: () => opened.promise })
    await app.start()

    const clicks = Promise.all([app.install(), app.install()])
    await tick()

    expect(app.calls).toEqual(["check", "check", "external:https://files.test/2.0.0.dmg"])
    opened.resolve()
    await clicks
    expect(app.state()).toEqual({ status: "download-required", version: "2.0.0" })
  })

  test("concurrent checks share one platform check", async () => {
    const app = await setup()

    await Promise.all([app.check(), app.check(), app.check()])

    expect(app.calls).toEqual(["check", "download"])
  })

  test("install during a silent refresh waits for the download, then installs the newer version", async () => {
    const download = { slow: false, done: Promise.withResolvers<void>() }

    const app = await setup({
      checks: ["2.0.0", "3.0.0"],
      stage: () => (download.slow ? download.done.promise : Promise.resolve()),
    })

    await app.start()

    download.slow = true
    const refresh = app.check()
    await tick()
    app.installFork()
    expect(app.state()).toEqual({ status: "installing", version: "2.0.0" })

    download.done.resolve()
    await refresh
    expect(app.state()).toEqual({ status: "installing", version: "3.0.0" })
    await tick()
    expect(app.calls).toEqual(["check", "download", "check", "download:full", "prepare", "install:3.0.0"])
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
    await tick()
    expect(attempts.count).toBe(2)
    expect(app.state()).toEqual({ status: "installing", version: "2.0.0" })
  })
})
