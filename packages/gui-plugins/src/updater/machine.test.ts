import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import type { UpdaterState } from "@opencode/plugin/gui/updater"
import {
  initUpdaterMachine,
  make,
  toUpdaterState,
  transitionUpdater,
  type Dependencies,
  type UpdaterMachineEffect,
  type UpdaterMachineEvent,
  type UpdaterMachineState,
  type UpdateTarget,
} from "./machine"

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
  /**
   * The release each platform check finds, in order; the last one repeats. "offline" fails the check, "none" finds
   * nothing and "external:<version>" finds an external download.
   */
  checks?: readonly string[]
  /** Holds every check after the launch check until it resolves. */
  held?: Promise<void>
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
      checkForUpdate: Effect.suspend(() => {
        calls.push("check")
        const launch = cursor.check === 0
        const result = found(checks[Math.min(cursor.check++, checks.length - 1)] ?? "2.0.0", !!input?.external)
        const held = input?.held

        if (launch || !held) return result

        return Effect.promise(() => held).pipe(Effect.andThen(result))
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
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

function found(next: string, external: boolean): Effect.Effect<UpdateTarget | undefined, Error> {
  if (next === "offline") return Effect.fail(new Error("offline"))

  if (next === "none") return Effect.succeed(undefined)
  const version = next.replace("external:", "")

  if (external || next.startsWith("external:"))
    return Effect.succeed({ mode: "external", version, url: `https://files.test/${version}.dmg` })

  return Effect.succeed({ mode: "restart", version })
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

  // Check for Updates reports what this resolves to, so a staged update must come back as ready, not silently.
  test("a manual check while an update is staged resolves to the staged version", async () => {
    const app = await setup({ checks: ["2.0.0"] })
    await app.start()

    expect(await app.check()).toEqual({ status: "ready", version: "2.0.0" })
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

  test("an external install shows installing at once, and a check meanwhile runs no second platform check", async () => {
    const held = Promise.withResolvers<void>()
    const app = await setup({ external: true, held: held.promise })
    await app.start()

    const click = app.install()
    expect(app.state()).toEqual({ status: "installing", version: "2.0.0" })
    expect(await app.check()).toEqual({ status: "installing", version: "2.0.0" })

    held.resolve()
    await click
    expect(app.calls).toEqual(["check", "check", "external:https://files.test/2.0.0.dmg"])
  })

  test("an install never restarts into a staged update that the final check replaced with a download", async () => {
    const app = await setup({ checks: ["2.0.0", "external:2.1.0"] })
    await app.start()

    await app.install()
    expect(app.calls).toEqual(["check", "download", "check"])
    expect(app.state()).toEqual({ status: "download-required", version: "2.1.0" })
    expect(app.getReady()).toBeUndefined()
  })

  test("an external install never opens a download that the final check withdrew", async () => {
    const app = await setup({ external: true, checks: ["2.0.0", "none"] })
    await app.start()

    await expect(app.install()).rejects.toThrow("External installer is unavailable")
    expect(app.calls).toEqual(["check", "check"])
    expect(app.state()).toEqual({ status: "up-to-date" })
  })

  test("closing the updater settles every caller still waiting", async () => {
    const app = await setup({ checks: ["2.0.0"], held: new Promise<void>(() => {}) })
    await app.start()

    const checks = Promise.all([app.check(), app.check()])
    const click = app.install()
    await app.close()

    expect(await checks).toEqual([
      { status: "installing", version: "2.0.0" },
      { status: "installing", version: "2.0.0" },
    ])
    await expect(click).rejects.toThrow("Updater stopped")
  })
})

const url = (version: string) => `https://files.test/${version}.dmg`

function idle(input?: { canExternalInstall?: boolean; persistedVersion?: string }) {
  return initUpdaterMachine({
    currentVersion: "1.0.0",
    enabled: true,
    canExternalInstall: input?.canExternalInstall ?? true,
    persistedVersion: input?.persistedVersion,
  }).state
}

// Folds events the way the driver applies them and collects every effect.
function run(state: UpdaterMachineState, ...events: UpdaterMachineEvent[]) {
  return events.reduce<{ state: UpdaterMachineState; effects: UpdaterMachineEffect[] }>(
    (step, event) => {
      const next = transitionUpdater(step.state, event)

      return { state: next.state, effects: [...step.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

// 2.0.0 staged after check attempt 1 and download attempt 2.
const ready = () =>
  run(
    idle(),
    { type: "check.requested", waiter: 1 },
    { type: "check.succeeded", attempt: 1, target: { mode: "restart", version: "2.0.0" } },
    { type: "stage.succeeded", attempt: 2 },
  ).state

// 2.0.0 offered as an external download after check attempt 1.
const offered = (input?: { canExternalInstall?: boolean }) =>
  run(
    idle(input),
    { type: "check.requested", waiter: 1 },
    { type: "check.succeeded", attempt: 1, target: { mode: "external", version: "2.0.0", url: url("2.0.0") } },
  ).state

const platformCalls = (effects: readonly UpdaterMachineEffect[]) =>
  effects.flatMap((effect) => (effect.type.startsWith("platform.") ? [effect.type] : []))

describe("transitionUpdater", () => {
  test.each([
    { name: "disabled", input: { enabled: false }, state: { status: "disabled" }, effects: [] },
    { name: "clean launch", input: {}, state: { status: "idle", cached: undefined }, effects: [] },
    {
      name: "launch after installing the persisted release",
      input: { persistedVersion: "1.0.0" },
      state: { status: "idle", cached: undefined },
      effects: [{ type: "persistence.clear" }],
    },
    {
      name: "launch with a persisted release never installed",
      input: { persistedVersion: "2.0.0" },
      state: { status: "idle", cached: "2.0.0" },
      effects: [],
    },
  ])("init: $name", (row) => {
    const init = initUpdaterMachine({
      currentVersion: "1.0.0",
      enabled: true,
      canExternalInstall: false,
      persistedVersion: undefined,
      ...row.input,
    })

    expect(init.state).toMatchObject(row.state)
    expect(init.effects).toEqual(row.effects)
  })

  test("a stale release in the updater cache downloads the next one in full", () => {
    const step = run(
      idle({ persistedVersion: "2.0.0" }),
      { type: "check.requested", waiter: 1 },
      { type: "check.succeeded", attempt: 1, target: { mode: "restart", version: "3.0.0" } },
    )

    expect(step.effects.at(-1)).toEqual({ type: "platform.stage", attempt: 2, differential: false })
  })

  test("an external install claims the updater at once; a check meanwhile answers without checking", () => {
    const install = run(offered(), { type: "install.requested", waiter: 2 })
    expect(toUpdaterState(install.state)).toEqual({ status: "installing", version: "2.0.0" })
    expect(install.effects).toEqual([{ type: "platform.check", attempt: 2 }])

    const check = run(install.state, { type: "check.requested", waiter: 3 })
    expect(check.effects).toEqual([
      { type: "checks.resolve", waiters: [3], state: { status: "installing", version: "2.0.0" } },
    ])
  })

  test("an install adopts the silent check already running instead of starting another", () => {
    const step = run(offered(), { type: "check.requested", waiter: 2 }, { type: "install.requested", waiter: 3 })

    expect(platformCalls(step.effects)).toEqual(["platform.check"])
    expect(step.state).toMatchObject({
      status: "installing",
      plan: { step: "checking", attempt: 2, checkWaiters: [2] },
    })
  })

  test.each([
    { name: "its own check", events: [{ type: "install.requested", waiter: 3 }] },
    {
      name: "an adopted silent check",
      events: [
        { type: "check.requested", waiter: 4 },
        { type: "install.requested", waiter: 3 },
      ],
    },
  ] satisfies { name: string; events: UpdaterMachineEvent[] }[])(
    "a restart install that finds an external download offers it instead of restarting ($name)",
    (row) => {
      const step = run(ready(), ...row.events, {
        type: "check.succeeded",
        attempt: 3,
        target: { mode: "external", version: "2.1.0", url: url("2.1.0") },
      })

      expect(toUpdaterState(step.state)).toEqual({ status: "download-required", version: "2.1.0" })
      expect(platformCalls(step.effects)).toEqual(["platform.check"])
      expect(step.effects).toContainEqual({ type: "persistence.clear" })
      expect(step.effects).toContainEqual({ type: "installs.resolve", waiters: [3] })
    },
  )

  test.each([
    { name: "withdrawn", target: undefined, state: { status: "up-to-date" } },
    {
      name: "replaced by a restart release",
      target: { mode: "restart", version: "2.1.0" },
      state: { status: "downloading", version: "2.1.0" },
    },
  ] satisfies { name: string; target: UpdateTarget | undefined; state: UpdaterState }[])(
    "an external install never opens a download the final check $name",
    (row) => {
      const step = run(
        offered(),
        { type: "install.requested", waiter: 2 },
        { type: "check.succeeded", attempt: 2, target: row.target },
      )

      expect(toUpdaterState(step.state)).toEqual(row.state)
      expect(platformCalls(step.effects)).not.toContain("platform.external")
      expect(step.effects).toContainEqual({
        type: "installs.reject",
        waiters: [2],
        failure: { kind: "external-unavailable" },
      })
    },
  )

  test("an external install without an installer fails at once", () => {
    const state = offered({ canExternalInstall: false })
    const step = transitionUpdater(state, { type: "install.requested", waiter: 2 })

    expect(step.state).toBe(state)
    expect(step.effects).toEqual([{ type: "installs.reject", waiters: [2], failure: { kind: "external-unavailable" } }])
  })

  test("an install restarts into the staged release when downloading a newer one fails", () => {
    const step = run(
      ready(),
      { type: "install.requested", waiter: 3 },
      { type: "check.succeeded", attempt: 3, target: { mode: "restart", version: "3.0.0" } },
      { type: "stage.failed", attempt: 4, message: "offline" },
    )

    expect(step.state).toMatchObject({ status: "installing", plan: { version: "2.0.0", step: "restarting" } })
    expect(platformCalls(step.effects)).toEqual(["platform.check", "platform.stage", "platform.restart"])
  })

  test("a restart handoff holds installing once the app quits, and returns to ready when it fails", () => {
    const restarting = run(
      ready(),
      { type: "install.requested", waiter: 3 },
      { type: "check.succeeded", attempt: 3, target: undefined },
    ).state

    const quit = transitionUpdater(restarting, { type: "restart.succeeded", attempt: 4 })
    expect(toUpdaterState(quit.state)).toEqual({ status: "installing", version: "2.0.0" })
    expect(quit.effects).toEqual([{ type: "installs.resolve", waiters: [3] }])

    const error = new Error("install failed")
    const failed = transitionUpdater(restarting, { type: "restart.failed", attempt: 4, error })
    expect(toUpdaterState(failed.state)).toEqual({ status: "ready", version: "2.0.0" })
    expect(failed.effects).toEqual([{ type: "installs.reject", waiters: [3], failure: { kind: "error", error } }])
  })

  test.each([
    { name: "checking", state: () => run(idle(), { type: "check.requested", waiter: 1 }).state },
    {
      name: "downloading",
      state: () =>
        run(
          idle(),
          { type: "check.requested", waiter: 1 },
          { type: "check.succeeded", attempt: 1, target: { mode: "restart", version: "2.0.0" } },
        ).state,
    },
    { name: "a silent refresh", state: () => run(ready(), { type: "check.requested", waiter: 2 }).state },
    { name: "an external refresh", state: () => run(offered(), { type: "check.requested", waiter: 2 }).state },
    { name: "an installation", state: () => run(ready(), { type: "install.requested", waiter: 2 }).state },
  ])("ignores results of a superseded attempt during $name", (row) => {
    const state = row.state()

    const events: UpdaterMachineEvent[] = [
      { type: "check.succeeded", attempt: 99, target: undefined },
      { type: "check.failed", attempt: 99, message: "offline" },
      { type: "stage.succeeded", attempt: 99 },
      { type: "stage.failed", attempt: 99, message: "offline" },
      { type: "restart.succeeded", attempt: 99 },
      { type: "restart.failed", attempt: 99, error: new Error("failed") },
      { type: "external.succeeded", attempt: 99 },
      { type: "external.failed", attempt: 99, error: new Error("failed") },
    ]

    events.forEach((event) => {
      const step = transitionUpdater(state, event)
      expect(step.state).toBe(state)
      expect(step.effects).toEqual([])
    })
  })

  test("a caller that stops waiting leaves the check running for the others", () => {
    const step = run(
      idle(),
      { type: "check.requested", waiter: 1 },
      { type: "check.requested", waiter: 2 },
      { type: "waiter.cancelled", waiter: 1 },
      { type: "check.succeeded", attempt: 1, target: undefined },
    )

    expect(step.effects).toEqual([
      { type: "platform.check", attempt: 1 },
      { type: "persistence.clear" },
      { type: "checks.resolve", waiters: [2], state: { status: "up-to-date" } },
    ])
  })

  test("disposing cancels the running attempt, settles every caller and ignores later events", () => {
    const installing = run(ready(), { type: "check.requested", waiter: 2 }, { type: "install.requested", waiter: 3 })
    const disposed = transitionUpdater(installing.state, { type: "disposed" })

    expect(disposed.effects).toEqual([
      { type: "attempt.cancel", attempt: 3 },
      { type: "installs.reject", waiters: [3], failure: { kind: "disposed" } },
      { type: "checks.resolve", waiters: [2], state: { status: "installing", version: "2.0.0" } },
    ])
    expect(transitionUpdater(disposed.state, { type: "check.succeeded", attempt: 3, target: undefined }).state).toBe(
      disposed.state,
    )
    expect(transitionUpdater(disposed.state, { type: "install.requested", waiter: 4 }).effects).toEqual([
      { type: "installs.reject", waiters: [4], failure: { kind: "disposed" } },
    ])
  })

  test("disposing leaves a restart handoff to ApplicationLifecycle", () => {
    const restarting = run(
      ready(),
      { type: "install.requested", waiter: 3 },
      { type: "check.succeeded", attempt: 3, target: undefined },
    ).state

    expect(transitionUpdater(restarting, { type: "disposed" }).effects).toEqual([
      { type: "installs.reject", waiters: [3], failure: { kind: "disposed" } },
    ])
  })
})
