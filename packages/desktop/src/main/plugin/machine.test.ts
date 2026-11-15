import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { PluginError } from "./error"
import { createDriver, initialState, LOAD_TIMEOUT_MS, loadedHost, transition, type Event, type State } from "./machine"

type Host = { readonly name: string }

const host: Host = { name: "host" }

const reply = () => ({ resolve: () => {}, reject: () => {} })

/** Applies the events in order and returns the last state. */
const replay = (events: readonly Event<Host>[], from: State<Host> = initialState()) =>
  events.reduce((state, event) => transition(state, event).state, from)

const eperm = Object.assign(new Error("EPERM: operation not permitted, copyfile"), { code: "EPERM" })

describe("plugin host machine", () => {
  test.each([
    {
      name: "a newer load is in flight",
      state: replay([
        { type: "host.requested", reply: reply() },
        { type: "load.failed", attempt: 1, error: eperm },
        { type: "host.requested", reply: reply() },
      ]),
    },
    {
      name: "a stop dropped the load",
      state: replay([
        { type: "host.requested", reply: reply() },
        { type: "stop.requested", reply: reply() },
      ]),
    },
    {
      name: "the app disposed the host",
      state: replay([{ type: "host.requested", reply: reply() }, { type: "disposed" }]),
    },
  ])("drops a late result for load 1 when $name", (row) => {
    const late = [
      { type: "load.succeeded", attempt: 1, host },
      { type: "load.failed", attempt: 1, error: eperm },
      { type: "load.timed-out", attempt: 1 },
    ] satisfies Event<Host>[]

    late.forEach((event) => expect(transition(row.state, event)).toEqual({ state: row.state, commands: [] }))
  })

  test("a loaded host stays reachable through a stop, for the plugin a restart handoff keeps", () => {
    const ready = replay([
      { type: "host.requested", reply: reply() },
      { type: "load.succeeded", attempt: 1, host },
    ])

    const stopped = transition(ready, { type: "stop.requested", reply: reply() })

    expect(stopped.state).toBe(ready)
    expect(loadedHost(stopped.state)).toBe(host)
    expect(stopped.commands.map((command) => command.type)).toEqual(["stop"])
  })

  test("disposal hides the host and refuses later loads", () => {
    const disposed = replay([
      { type: "host.requested", reply: reply() },
      { type: "load.succeeded", attempt: 1, host },
      { type: "disposed" },
    ])

    expect(loadedHost(disposed)).toBeUndefined()
    expect(transition(disposed, { type: "host.requested", reply: reply() }).commands).toEqual([
      expect.objectContaining({ type: "reject", reason: { kind: "unavailable" } }),
    ])
  })
})

/** A host that counts how often main plugins started, which Ipcs it was asked for, and how often a load built one. */
const fixture = () => {
  const built = { count: 0 }
  const demanded: string[] = []
  const calls = { start: 0, demand: demanded }

  const fake = {
    start: async () => void calls.start++,
    stop: async () => {},
    resume: async () => {},
    demand: (ipc: string) => void calls.demand.push(ipc),
  }

  const loads: PromiseWithResolvers<() => typeof fake>[] = []

  const build = () => {
    built.count++

    return fake
  }

  const driver = createDriver({
    load: () => {
      const load = Promise.withResolvers<() => typeof fake>()
      loads.push(load)

      return load.promise
    },
    subscribed: () => ["opencode.servers.list"],
    log: () => {},
  })

  return { driver, loads, built, calls, build, fake }
}

// Fake timers leave setImmediate real: one turn drains every pending microtask.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

describe("plugin host driver", () => {
  beforeEach(() => jest.useFakeTimers())

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test("a boot start that failed to load activates main plugins once a later use loads the host", async () => {
    const plugins = fixture()
    const boot = plugins.driver.start()
    await flush()
    plugins.loads[0].reject(eperm)
    await expect(boot).rejects.toBe(eperm)

    // On dev the rejected load was kept, so every later use failed until the app relaunched.
    plugins.driver.demand("opencode.servers.list")
    await flush()
    plugins.loads[1].resolve(plugins.build)
    await flush()

    expect(plugins.calls.start).toBe(1)
    expect(plugins.driver.state()).toEqual({ status: "ready", host: plugins.fake, started: true })
  })

  test("a subscription made while the load failed activates its plugin once a later load succeeds", async () => {
    const plugins = fixture()
    plugins.driver.demand("opencode.servers.list")
    await flush()
    plugins.loads[0].reject(eperm)
    await flush()

    const list = plugins.driver.host()
    await flush()
    plugins.loads[1].resolve(plugins.build)
    await list

    expect(plugins.calls.demand).toEqual(["opencode.servers.list"])
    expect(plugins.calls.start).toBe(0)
  })

  test("a boot load that times out still activates main plugins when the CLI lookup finishes late", async () => {
    const plugins = fixture()
    const boot = plugins.driver.start()
    await flush()

    jest.advanceTimersByTime(LOAD_TIMEOUT_MS)
    await expect(boot).rejects.toMatchObject({ code: "failed", message: "plugin host load timed out" })

    plugins.loads[0].resolve(plugins.build)
    await flush()

    expect(plugins.calls.start).toBe(1)
    expect(plugins.driver.state()).toEqual({ status: "ready", host: plugins.fake, started: true })
  })

  test("a hung load times out, and the next use loads again without building the hung one", async () => {
    const plugins = fixture()
    const first = plugins.driver.host()
    await flush()

    jest.advanceTimersByTime(LOAD_TIMEOUT_MS)
    await expect(first).rejects.toMatchObject({ code: "failed" })

    const second = plugins.driver.host()
    await flush()
    plugins.loads[1].resolve(plugins.build)
    expect(await second).toBe(plugins.fake)

    plugins.loads[0].resolve(plugins.build)
    await flush()
    expect(plugins.built.count).toBe(1)
  })

  test("a quit during the load never builds the host and does not wait for the load", async () => {
    const plugins = fixture()
    const list = plugins.driver.host()
    await flush()

    // On dev the stop waited for the CLI copy, then built a host against closing storage only to stop it.
    await plugins.driver.stop()
    await expect(list).rejects.toBeInstanceOf(PluginError)
    await expect(list).rejects.toMatchObject({ code: "unavailable" })

    plugins.loads[0].resolve(plugins.build)
    await flush()

    expect(plugins.built.count).toBe(0)
    expect(plugins.driver.state().status).toBe("stopped")
  })

  test("a quit before any load refuses later uses until the plugins resume, then starts what boot asked for", async () => {
    const plugins = fixture()
    await plugins.driver.stop()

    // On dev a window's request during the quit built a host that nothing stopped.
    await expect(plugins.driver.host()).rejects.toMatchObject({ code: "unavailable" })
    await plugins.driver.start()
    expect(plugins.loads).toHaveLength(0)

    // A failed restart handoff resumes the app.
    const resumed = plugins.driver.resume()
    await flush()
    plugins.loads[0].resolve(plugins.build)
    await resumed

    expect(plugins.calls.start).toBe(1)
  })
})
