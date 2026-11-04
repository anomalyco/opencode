import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { PluginError } from "./error"
import {
  createDriver,
  initialState,
  LOAD_TIMEOUT_MS,
  loadedHost,
  transition,
  type Command,
  type Event,
  type Reply,
  type State,
} from "./machine"

type Host = { readonly name: string }

const host: Host = { name: "host" }

const reply = <Value = void>(): Reply<Value> => ({ resolve: () => {}, reject: () => {} })

/** Applies the events in order and returns the last state with every command they produced. */
const replay = (events: readonly Event<Host>[], from: State<Host> = initialState()) =>
  events.reduce<{ state: State<Host>; commands: Command<Host>[] }>(
    (result, event) => {
      const next = transition(result.state, event)

      return { state: next.state, commands: [...result.commands, ...next.commands] }
    },
    { state: from, commands: [] },
  )

const eperm = Object.assign(new Error("EPERM: operation not permitted, copyfile"), { code: "EPERM" })

describe("plugin host machine", () => {
  test("a failed boot load runs again on the next use and still activates main plugins", () => {
    const boot = reply()
    const list = reply<Host>()

    const failed = replay([
      { type: "start.requested", reply: boot },
      { type: "load.failed", attempt: 1, error: eperm },
    ])

    // On dev the rejected load was kept, so every later use failed until the app relaunched.
    expect(failed.state).toEqual({ status: "idle", attempt: 1, started: true })
    expect(failed.commands).toEqual([
      { type: "load", attempt: 1 },
      { type: "reject", replies: [boot], reason: { kind: "failed", error: eperm } },
    ])

    const recovered = replay(
      [
        { type: "host.requested", reply: list },
        { type: "load.succeeded", attempt: 2, host },
      ],
      failed.state,
    )

    // Nothing calls `start` again after boot, so the load that succeeds carries it.
    expect(recovered.state).toEqual({ status: "ready", host, started: true })
    expect(recovered.commands).toEqual([
      { type: "load", attempt: 2 },
      { type: "resolve-host", host, replies: [list] },
      { type: "start", host, replies: [] },
    ])
  })

  test("Ipcs subscribed while a load failed are demanded once a later load succeeds", () => {
    const result = replay([
      { type: "demand.requested", ipc: "opencode.servers.list" },
      { type: "load.failed", attempt: 1, error: eperm },
      { type: "demand.requested", ipc: "opencode.servers.list" },
      { type: "load.succeeded", attempt: 2, host },
    ])

    expect(result.state).toEqual({ status: "ready", host, started: false })
    expect(result.commands).toEqual([
      { type: "load", attempt: 1 },
      { type: "load", attempt: 2 },
      { type: "demand-subscribed", host },
    ])
  })

  test("a stop before any host loaded refuses loads until the plugins resume", () => {
    const stop = reply()
    const late = reply<Host>()
    const resume = reply()

    const stopped = replay([
      { type: "stop.requested", reply: stop },
      { type: "host.requested", reply: late },
      { type: "demand.requested", ipc: "opencode.servers.list" },
    ])

    // On dev a window's request during the quit built a host that nothing stopped.
    expect(stopped.state).toEqual({ status: "stopped", attempt: 0, started: false })
    expect(stopped.commands).toEqual([
      { type: "resolve", replies: [stop] },
      { type: "reject", replies: [late], reason: { kind: "unavailable" } },
    ])

    // A failed restart handoff resumes the app, and plugins load on demand again.
    const resumed = replay(
      [
        { type: "resume.requested", reply: resume },
        { type: "demand.requested", ipc: "opencode.servers.list" },
      ],
      stopped.state,
    )

    expect(resumed.state.status).toBe("loading")
    expect(resumed.commands).toEqual([
      { type: "resolve", replies: [resume] },
      { type: "load", attempt: 1 },
    ])
  })

  test("a stop drops the load in flight at once, and a resume loads again and starts what boot asked for", () => {
    const boot = reply()
    const list = reply<Host>()
    const stop = reply()
    const resume = reply()

    const stopped = replay([
      { type: "start.requested", reply: boot },
      { type: "host.requested", reply: list },
      { type: "stop.requested", reply: stop },
    ])

    // On dev the stop waited for the CLI copy, then built a host only to stop it.
    expect(stopped.state).toEqual({ status: "stopped", attempt: 1, started: true })
    expect(stopped.commands).toEqual([
      { type: "load", attempt: 1 },
      { type: "reject", replies: [list], reason: { kind: "unavailable" } },
      { type: "resolve", replies: [boot, stop] },
    ])

    const late = transition(stopped.state, { type: "load.succeeded", attempt: 1, host })
    expect(late.state).toBe(stopped.state)
    expect(late.commands).toEqual([])

    const resumed = replay(
      [
        { type: "resume.requested", reply: resume },
        { type: "load.succeeded", attempt: 1, host },
        { type: "load.succeeded", attempt: 2, host },
      ],
      stopped.state,
    )

    expect(resumed.state).toEqual({ status: "ready", host, started: true })
    expect(resumed.commands).toEqual([
      { type: "load", attempt: 2 },
      { type: "start", host, replies: [resume] },
    ])
  })

  test("a timed-out load fails its callers, and its late result is dropped", () => {
    const first = reply<Host>()
    const second = reply<Host>()

    const result = replay([
      { type: "host.requested", reply: first },
      { type: "load.timed-out", attempt: 1 },
      { type: "host.requested", reply: second },
    ])

    expect(result.commands).toEqual([
      { type: "load", attempt: 1 },
      { type: "reject", replies: [first], reason: { kind: "timed-out" } },
      { type: "load", attempt: 2 },
    ])

    const stale = [
      { type: "load.succeeded", attempt: 1, host },
      { type: "load.failed", attempt: 1, error: eperm },
      { type: "load.timed-out", attempt: 1 },
    ] satisfies Event<Host>[]

    stale.forEach((event) => {
      const next = transition(result.state, event)
      expect(next.state).toBe(result.state)
      expect(next.commands).toEqual([])
    })
  })

  test("concurrent uses share one load", () => {
    const hosts = [reply<Host>(), reply<Host>()]
    const boot = reply()

    const result = replay([
      { type: "demand.requested", ipc: "opencode.servers.list" },
      { type: "host.requested", reply: hosts[0] },
      { type: "start.requested", reply: boot },
      { type: "host.requested", reply: hosts[1] },
      { type: "load.succeeded", attempt: 1, host },
    ])

    expect(result.commands).toEqual([
      { type: "load", attempt: 1 },
      { type: "resolve-host", host, replies: hosts },
      { type: "start", host, replies: [boot] },
    ])
  })

  test("a stop and a resume pass through to a loaded host, which stays reachable for the plugin a handoff keeps", () => {
    const ready = replay([
      { type: "host.requested", reply: reply() },
      { type: "load.succeeded", attempt: 1, host },
    ]).state

    const stops = [reply(), reply()]
    const kept = reply<Host>()
    const resume = reply()

    // The restart stops every plugin but the updater; a quit during the handoff stops the updater too.
    const result = replay(
      [
        { type: "stop.requested", reply: stops[0] },
        { type: "host.requested", reply: kept },
        { type: "stop.requested", reply: stops[1] },
        { type: "resume.requested", reply: resume },
      ],
      ready,
    )

    expect(result.state).toBe(ready)
    expect(loadedHost(result.state)).toBe(host)
    expect(result.commands).toEqual([
      { type: "stop", host, reply: stops[0] },
      { type: "resolve-host", host, replies: [kept] },
      { type: "stop", host, reply: stops[1] },
      { type: "resume", host, reply: resume },
    ])
  })

  test("disposal settles waiters, hides the host and refuses every later load", () => {
    const list = reply<Host>()
    const boot = reply()
    const late = reply<Host>()

    const result = replay([
      { type: "host.requested", reply: list },
      { type: "start.requested", reply: boot },
      { type: "disposed" },
      { type: "load.succeeded", attempt: 1, host },
      { type: "host.requested", reply: late },
      { type: "demand.requested", ipc: "opencode.servers.list" },
    ])

    expect(result.state).toEqual({ status: "disposed" })
    expect(result.commands).toEqual([
      { type: "load", attempt: 1 },
      { type: "reject", replies: [list], reason: { kind: "unavailable" } },
      { type: "resolve", replies: [boot] },
      { type: "reject", replies: [late], reason: { kind: "unavailable" } },
    ])

    const ready = replay([
      { type: "host.requested", reply: reply() },
      { type: "load.succeeded", attempt: 1, host },
      { type: "disposed" },
    ])

    expect(loadedHost(ready.state)).toBeUndefined()
  })
})

/** A host that counts how often each lifecycle step ran, and how often a load built one. */
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

  test("a quit during the load never builds the host and does not wait for the load", async () => {
    const plugins = fixture()
    const list = plugins.driver.host()
    await flush()

    await plugins.driver.stop()
    await expect(list).rejects.toBeInstanceOf(PluginError)
    await expect(list).rejects.toMatchObject({ code: "unavailable" })

    plugins.loads[0].resolve(plugins.build)
    await flush()

    expect(plugins.built.count).toBe(0)
    expect(plugins.driver.state().status).toBe("stopped")
  })

  test("a hung load times out, and the next use loads again without building the hung one", async () => {
    const plugins = fixture()
    const first = plugins.driver.host()
    await flush()

    jest.advanceTimersByTime(LOAD_TIMEOUT_MS)
    await expect(first).rejects.toMatchObject({ code: "failed", message: "plugin host load timed out" })

    const second = plugins.driver.host()
    await flush()
    plugins.loads[1].resolve(plugins.build)
    expect(await second).toBe(plugins.fake)

    plugins.loads[0].resolve(plugins.build)
    await flush()
    expect(plugins.built.count).toBe(1)
  })

  test("a boot start that failed to load activates main plugins once a later use loads the host", async () => {
    const plugins = fixture()
    const boot = plugins.driver.start()
    await flush()
    plugins.loads[0].reject(eperm)
    await expect(boot).rejects.toBe(eperm)

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
})
