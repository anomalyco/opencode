import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { createLifecycle, type Instance, type Revision } from "./lifecycle"

// The host's cleanup deadline and setup stall log, as `lifecycle.ts` sets them.
const CLEANUP_MS = 3_000

const STALL_MS = 10_000

type Wait = number | "hang"

type Plan = {
  readonly load?: Wait
  readonly loadFails?: boolean
  readonly ready?: Wait
  readonly setup?: Wait
  readonly setupFails?: boolean
  /** The finalizer setup adds before its await. */
  readonly cleanup?: Wait
  /** The finalizer setup adds after its await, as it finishes. */
  readonly late?: Wait
}

type Made = { readonly id: string; readonly revision: string; readonly label: string; readonly instance: Instance }

type Contribution = { readonly made: Made; readonly kind: "ipc" | "listener" | "embed"; readonly window?: number }

beforeEach(() => jest.useFakeTimers())

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

// Fake timers leave setImmediate real: one turn drains every pending microtask.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

const advance = async (ms: number, step = 10) => {
  for (let left = ms; left > 0; left -= step) {
    jest.advanceTimersByTime(Math.min(step, left))
    await flush()
  }
}

const wait = (value: Wait | undefined) => {
  if (value === "hang") return new Promise<void>(() => {})

  if (!value) return Promise.resolve()

  return new Promise<void>((resolve) => setTimeout(resolve, value))
}

/**
 * A fake host around the real lifecycle: extensions whose code loads, prepares, sets up and cleans up on a plan, and
 * a registry of what each instance contributed, including embeds in windows that open and close.
 */
function world() {
  const logs: { readonly message: string; readonly data: object }[] = []
  const events: string[] = []
  const enabled = new Map<string, boolean>()
  const revisions = new Map<string, { readonly name: string; readonly plan: Plan }>()
  const versions = new Map<string, number>()
  const made: Made[] = []
  const contributions = new Set<Contribution>()
  const violations: string[] = []
  const windows = new Set<number>()
  const openers = new Set<(window: number) => void>()
  const counter = { window: 0 }
  // Setups that finished after their instance stopped, and those that did while a replacement ran.
  const stats = { late: 0, overlapping: 0 }
  /** The instances neither stopped nor stopping. */
  const live = (id?: string) => made.filter((item) => !item.instance.scope.signal.aborted && (!id || item.id === id))

  const contribute = (owner: Made, kind: Contribution["kind"], window?: number, withdraw?: () => void) => {
    const entry: Contribution = { made: owner, kind, window }
    contributions.add(entry)
    owner.instance.contribute(() => {
      // Only the owner's own disposal withdraws what it contributed.
      if (!owner.instance.scope.signal.aborted) violations.push(`${kind} of live ${owner.label} withdrawn`)
      contributions.delete(entry)
      withdraw?.()
    })
  }

  const revision =
    (id: string, name: string, plan: Plan): Revision =>
    (instance) => {
      const owner: Made = { id, revision: name, label: `${name}#${made.length + 1}`, instance }
      made.push(owner)

      return {
        ready: wait(plan.ready),
        setup: async () => {
          events.push(`setup ${owner.label}`)
          contribute(owner, "ipc")
          instance.scope.addFinalizer(async () => {
            events.push(`cleanup ${owner.label}`)
            await wait(plan.cleanup)
            events.push(`cleanup ${owner.label} done`)
          })
          await wait(plan.setup)

          if (plan.setupFails) throw new Error(`${owner.label} setup failed`)

          if (instance.scope.signal.aborted) stats.late++

          if (instance.scope.signal.aborted && live(id).length) stats.overlapping++
          // Registered after an await without checking the signal: a stopped instance withdraws them at once.
          windows.forEach((window) => contribute(owner, "embed", window))
          const opener = (window: number) => contribute(owner, "embed", window)
          openers.add(opener)
          contribute(owner, "listener", undefined, () => openers.delete(opener))
          events.push(`ready ${owner.label}`)
          // Added without checking the signal: a stopped instance runs it at once, and its disposal waits for it.
          instance.scope.addFinalizer(async () => {
            events.push(`late ${owner.label}`)
            await wait(plan.late)
            events.push(`late ${owner.label} done`)
          })
        },
      }
    }

  const lifecycle = createLifecycle({
    loader: (id) => {
      const current = revisions.get(id)

      if (!current) return undefined

      return () =>
        wait(current.plan.load).then(() => {
          if (current.plan.loadFails) throw new Error(`${current.name} load failed`)

          return revision(id, current.name, current.plan)
        })
    },
    enabled: (id) => enabled.get(id) ?? true,
    changed: () => {},
    log: (message, data) => logs.push({ message, data }),
  })

  /** Makes `plan` the extension's current code under a new revision name: a1, a2, … */
  const revise = (id: string, plan: Plan = {}) => {
    const version = (versions.get(id) ?? 0) + 1
    versions.set(id, version)
    revisions.set(id, { name: `${id}${version}`, plan })

    return `${id}${version}`
  }

  return {
    lifecycle,
    logs,
    stats,
    events,
    made,
    contributions,
    violations,
    enabled,
    revise,
    live,
    open() {
      const window = ++counter.window
      windows.add(window)
      ;[...openers].forEach((opener) => opener(window))

      return window
    },
    close(window: number) {
      windows.delete(window)
      // The host releases a closed window's embeds itself, whichever instance owns them.
      contributions.forEach((entry) => {
        if (entry.window === window) contributions.delete(entry)
      })
    },
    // The host's `install` and `remove` around the lifecycle.
    async install(id: string, plan: Plan = {}) {
      revise(id, plan)
      enabled.set(id, true)
      lifecycle.forget(id)
      await lifecycle.deactivate(id)
      await lifecycle.activate(id)
    },
    uninstall(id: string) {
      return lifecycle.deactivate(id, () => {
        revisions.delete(id)
        lifecycle.forget(id)
      })
    },
  }
}

type World = ReturnType<typeof world>

const settled = (promise: Promise<unknown>) => {
  const state = { settled: false, rejected: false }
  void promise.then(
    () => (state.settled = true),
    () => {
      state.settled = true
      state.rejected = true
    },
  )

  return state
}

/** The invariants every lifecycle state keeps. */
function check(w: World) {
  const counts = Map.groupBy(w.live(), (item) => item.id)
  counts.forEach((items, id) => {
    if (items.length > 1) throw new Error(`${items.length} live instances of ${id}: ${items.map((i) => i.label)}`)
  })
  w.contributions.forEach((entry) => {
    if (entry.made.instance.scope.signal.aborted)
      throw new Error(`${entry.kind} of stopped ${entry.made.label} is still contributed`)
  })

  if (w.violations.length) throw new Error(w.violations.join("; "))
}

describe("extension lifecycle contracts", () => {
  test.each([
    {
      name: "reload",
      stop: (w: World) => {
        w.revise("a")

        return w.lifecycle.reload("a")
      },
    },
    {
      name: "disable then enable",
      stop: (w: World) => {
        w.enabled.set("a", false)
        void w.lifecycle.deactivate("a")
        w.enabled.set("a", true)

        return w.lifecycle.activate("a")
      },
    },
    { name: "reinstall", stop: (w: World) => w.install("a") },
  ])("$name during async setup stops the instance at once and starts the next after its late cleanup", async (row) => {
    const w = world()
    w.revise("a", { setup: 50, late: 30 })
    void w.lifecycle.activate("a")
    await advance(10)
    expect(w.events).toEqual(["setup a1#1"])
    const done = settled(row.stop(w))
    // Withdrawn synchronously, before any cleanup runs.
    expect(w.live("a")).toEqual([])
    expect(w.contributions.size).toBe(0)
    await advance(200)
    check(w)
    expect(done.settled).toBe(true)
    const next = w.made[1]
    expect(w.live("a")).toEqual([next])
    // The setup that outlived its instance contributed nothing that stayed, and its late finalizer finished before
    // the next instance's setup started.
    expect(w.events).toEqual([
      "setup a1#1",
      "cleanup a1#1",
      "cleanup a1#1 done",
      "ready a1#1",
      "late a1#1",
      "late a1#1 done",
      `setup ${next.label}`,
      `ready ${next.label}`,
    ])
  })

  test("operations on one extension run in call order, each after the previous one settled", async () => {
    const w = world()
    w.revise("a", { cleanup: 40 })
    void w.lifecycle.activate("a")
    await advance(10)
    w.enabled.set("a", false)
    const disabled = settled(w.lifecycle.deactivate("a"))
    w.enabled.set("a", true)
    const enabled = settled(w.lifecycle.activate("a"))
    await advance(30)
    expect(disabled.settled).toBe(false)
    expect(w.made).toHaveLength(1)
    await advance(20)
    expect(disabled.settled).toBe(true)
    expect(enabled.settled).toBe(true)
    expect(w.events).toEqual([
      "setup a1#1",
      "ready a1#1",
      "late a1#1",
      "late a1#1 done",
      "cleanup a1#1",
      "cleanup a1#1 done",
      "setup a1#2",
      "ready a1#2",
    ])
  })

  test("a hung cleanup holds the queue only until the deadline", async () => {
    const w = world()
    w.revise("a", { cleanup: "hang" })
    void w.lifecycle.activate("a")
    await advance(10)
    w.enabled.set("a", false)
    const disabled = settled(w.lifecycle.deactivate("a"))
    w.enabled.set("a", true)
    void w.lifecycle.activate("a")
    await advance(CLEANUP_MS - 20)
    expect(disabled.settled).toBe(false)
    expect(w.made).toHaveLength(1)
    await advance(20)
    expect(disabled.settled).toBe(true)
    expect(w.live("a").map((item) => item.label)).toEqual(["a1#2"])
    expect(w.logs.map((entry) => entry.message)).toContain("scope finalizer timed out")
  })

  test.each([
    { phase: "loading", plan: { load: "hang" }, setup: false },
    { phase: "preparing", plan: { ready: "hang" }, setup: false },
    { phase: "setting up", plan: { setup: "hang" }, setup: true },
    { phase: "an activation waits behind a hung setup", plan: { setup: "hang" }, queued: true, setup: true },
    { phase: "tearing down", plan: { cleanup: "hang" }, teardown: true, setup: true },
  ] satisfies { phase: string; plan: Plan; setup: boolean; queued?: boolean; teardown?: boolean }[])(
    "quitting while $phase settles by the deadline and leaves nothing behind",
    async (row) => {
      const w = world()
      w.revise("a", row.plan)
      w.revise("b")
      void w.lifecycle.activate("a")
      void w.lifecycle.activate("b")
      await advance(10)

      if (row.queued) void w.lifecycle.activate("a")

      if (row.teardown) void w.lifecycle.deactivate("a")
      const quit = settled(w.lifecycle.dispose())
      expect(w.live()).toEqual([])
      expect(w.contributions.size).toBe(0)
      await advance(CLEANUP_MS + 20)
      expect(quit.settled).toBe(true)
      expect(w.events.includes("setup a1#1")).toBe(row.setup)
      check(w)
    },
  )

  test("a restart handoff keeps its scope's instance through quitting until the handoff settles", async () => {
    const w = world()
    w.revise("a")
    w.revise("b")
    await Promise.all([w.lifecycle.activate("a"), w.lifecycle.activate("b")])
    const [a, b] = w.made
    const handoff = { reject: (_: Error) => {} }

    const restart = settled(
      w.lifecycle.restart(a.instance.scope, async () => {
        await w.lifecycle.dispose()
        await new Promise<void>((_, reject) => (handoff.reject = reject))
      }),
    )

    await advance(CLEANUP_MS)
    expect(w.live()).toEqual([a])
    expect([...w.contributions].filter((entry) => entry.made === b)).toEqual([])
    expect([...w.contributions].some((entry) => entry.made === a)).toBe(true)
    handoff.reject(new Error("install failed"))
    await advance(10)
    expect(restart).toEqual({ settled: true, rejected: true })
    expect(w.live()).toEqual([a])
    // Once the handoff settled, quitting stops it like any other.
    const quit = settled(w.lifecycle.dispose())
    await advance(10)
    expect(quit.settled).toBe(true)
    expect(w.live()).toEqual([])
  })

  test("a restart handoff rejects a scope that is not an instance's", async () => {
    const w = world()
    w.revise("a")
    await w.lifecycle.activate("a")
    const ran = { handoff: false }
    const fork = w.made[0].instance.scope.fork("handoff")
    const restart = settled(w.lifecycle.restart(fork, async () => void (ran.handoff = true)))
    await advance(10)
    expect(restart).toEqual({ settled: true, rejected: true })
    expect(ran.handoff).toBe(false)
  })

  test.each([
    { name: "fails to load", plan: { loadFails: true }, live: "a1#1", failed: true },
    { name: "fails to set up", plan: { setupFails: true }, live: "a1#3", failed: true },
    { name: "succeeds", plan: {}, live: "a2#2", failed: false },
  ] satisfies { name: string; plan: Plan; live: string; failed: boolean }[])(
    "a reload that $name leaves the last good revision running",
    async (row) => {
      const w = world()
      w.revise("a")
      await w.lifecycle.activate("a")
      const previous = w.made[0]
      w.revise("a", row.plan)
      await w.lifecycle.reload("a")
      check(w)
      expect(w.live("a").map((item) => item.label)).toEqual([row.live])
      // The same instance when the new code failed to load: it kept running through the reload.
      expect(previous.instance.scope.signal.aborted).toBe(row.live !== previous.label)
      expect(w.lifecycle.failure("a") !== undefined).toBe(row.failed)
    },
  )

  test("a failed reload with no good revision leaves the extension stopped and failed", async () => {
    const w = world()
    w.revise("a", { setupFails: true })
    await w.lifecycle.activate("a")
    w.revise("a", { setupFails: true })
    await w.lifecycle.reload("a")
    expect(w.live("a")).toEqual([])
    expect(w.lifecycle.failure("a")).toBe("a2#2 setup failed")
  })

  test.each([
    { name: "a setup that hangs is logged once", setup: "hang", logged: 1 },
    { name: "a setup that finishes before the stall deadline is not logged", setup: STALL_MS - 1_000, logged: 0 },
  ] satisfies { name: string; setup: Wait; logged: number }[])("$name", async (row) => {
    const w = world()
    w.revise("a", { setup: row.setup })
    void w.lifecycle.activate("a")
    await advance(STALL_MS * 2, 500)
    expect(w.logs.filter((entry) => entry.message === "extension setup stalled")).toEqual(
      Array.from({ length: row.logged }, () => ({
        message: "extension setup stalled",
        data: { id: "a", ms: STALL_MS },
      })),
    )
  })
})

/** A deterministic random source, so a failing seed replays. */
function random(seed: number) {
  const state = { value: seed >>> 0 }

  const next = () => {
    state.value = (state.value + 0x6d2b79f5) >>> 0
    const mixed = Math.imul(state.value ^ (state.value >>> 15), 1 | state.value)
    const spread = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed

    return ((spread ^ (spread >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    chance: (p: number) => next() < p,
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
  }
}

type Random = ReturnType<typeof random>

// Mostly short; sometimes it hangs, or outlasts the cleanup deadline and then finishes while a replacement runs.
const delay = (rng: Random, hang: number, max: number): Wait => {
  if (rng.chance(hang)) return "hang"

  if (rng.chance(0.08)) return CLEANUP_MS + rng.int(CLEANUP_MS)

  return rng.chance(0.3) ? 0 : 1 + rng.int(max)
}

const plan = (rng: Random): Plan => ({
  load: delay(rng, 0.04, 40),
  loadFails: rng.chance(0.12),
  ready: delay(rng, 0.03, 20),
  setup: delay(rng, 0.05, 60),
  setupFails: rng.chance(0.12),
  cleanup: delay(rng, 0.1, 50),
  late: delay(rng, 0.05, 30),
})

const SEEDS = 1_000

const STEPS = 40

const IDS = ["a", "b", "c"]

/** How often the runs reached the cases the invariants are about, so a generator change cannot make them vacuous. */
const reached = { failedReloads: 0, lateSetups: 0, overlappingSetups: 0, hungFinalizers: 0, stalls: 0 }

async function fuzz(seed: number, trace: string[]) {
  const rng = random(seed)
  const w = world()
  const pending: { readonly op: string; readonly state: { settled: boolean } }[] = []
  // Operations that stop or replace an extension; a reload checked against the last good revision must be the latest.
  const superseded = new Map<string, number>()
  const model = { quitting: false }

  const run = (op: string, promise: Promise<unknown>) => {
    trace.push(op)
    pending.push({ op, state: settled(promise) })
  }

  const supersede = (id: string) => superseded.set(id, (superseded.get(id) ?? 0) + 1)
  IDS.forEach((id) => w.revise(id, plan(rng)))

  const ops = {
    activate: (id) => run(`activate ${id}`, w.lifecycle.activate(id)),
    enable: (id) => {
      w.enabled.set(id, true)
      run(`enable ${id}`, w.lifecycle.activate(id))
    },
    disable: (id) => {
      supersede(id)
      w.enabled.set(id, false)
      run(`disable ${id}`, w.lifecycle.deactivate(id))
    },
    reload: (id) => {
      supersede(id)
      const next = plan(rng)
      const name = w.revise(id, next)
      const marker = superseded.get(id)
      // The live instance whose setup finished: the revision a failed reload must leave running.
      const good = w.live(id).find((item) => w.events.includes(`ready ${item.label}`))
      run(
        `reload ${id} -> ${name} ${JSON.stringify(next)}`,
        w.lifecycle.reload(id).then(() => {
          const stale = superseded.get(id) !== marker || model.quitting || w.enabled.get(id) === false

          if (stale || !good || !(next.loadFails || next.setupFails)) return
          reached.failedReloads++

          if (!w.live(id).some((item) => item.revision === good.revision))
            w.violations.push(`failed reload to ${name} left no instance of ${good.revision} running`)

          if (w.lifecycle.failure(id) === undefined) w.violations.push(`failed reload to ${name} recorded nothing`)
        }),
      )
    },
    install: (id) => {
      supersede(id)
      run(`install ${id}`, w.install(id, plan(rng)))
    },
    remove: (id) => {
      supersede(id)
      run(`remove ${id}`, w.uninstall(id))
    },
    open: () => trace.push(`open window ${w.open()}`),
    close: () => {
      const window = rng.pick([...new Set([...w.contributions].flatMap((entry) => entry.window ?? []))])

      if (window === undefined) return
      trace.push(`close window ${window}`)
      w.close(window)
    },
    quit: () => {
      model.quitting = true
      IDS.forEach(supersede)
      run("quit", w.lifecycle.dispose())
    },
    wait: () => {},
  } satisfies Record<string, (id: string) => void>

  const weights: [keyof typeof ops, number][] = [
    ["activate", 2],
    ["enable", 1.5],
    ["disable", 1.5],
    ["reload", 3],
    ["install", 0.7],
    ["remove", 0.7],
    ["open", 1],
    ["close", 1],
    ["quit", 0.05],
    ["wait", 2],
  ]

  const bounds = weights.map(([op], index) => ({
    op,
    below: weights.slice(0, index + 1).reduce((sum, [, weight]) => sum + weight, 0),
  }))

  const choose = () => {
    const target = rng.next() * bounds[bounds.length - 1].below

    return bounds.find((bound) => target < bound.below)?.op ?? "wait"
  }

  for (let step = 0; step < STEPS; step++) {
    ops[choose()](rng.pick(IDS))
    check(w)
    const long = rng.chance(0.1)
    await advance(long ? CLEANUP_MS + 500 : rng.int(120), long ? 250 : 10)
    check(w)
  }

  // Quitting settles by the cleanup deadline, whatever hangs, and so does every operation still queued.
  ops.quit()
  await advance(CLEANUP_MS + 200, 20)
  const stuck = pending.flatMap((item) => (item.state.settled ? [] : [item.op]))

  if (stuck.length) throw new Error(`still pending ${CLEANUP_MS + 200}ms after quit: ${stuck.join(", ")}`)
  check(w)

  if (w.live().length) throw new Error(`live after quit: ${w.live().map((item) => item.label)}`)

  if (w.contributions.size) throw new Error(`${w.contributions.size} contributions left after quit`)
  reached.lateSetups += w.stats.late
  reached.overlappingSetups += w.stats.overlapping
  reached.hungFinalizers += w.logs.filter((entry) => entry.message === "scope finalizer timed out").length
  reached.stalls += w.logs.filter((entry) => entry.message === "extension setup stalled").length
}

test(`lifecycle invariants hold over ${SEEDS} random operation sequences`, async () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const trace: string[] = []
    await fuzz(seed, trace).catch((cause: unknown) => {
      throw new Error(`seed ${seed}: ${cause instanceof Error ? cause.message : String(cause)}\n${trace.join("\n")}`)
    })
    jest.clearAllTimers()
  }

  Object.values(reached).forEach((count) => expect(count).toBeGreaterThan(20))
})
