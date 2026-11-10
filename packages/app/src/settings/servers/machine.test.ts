import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import type { PluginServer } from "@/runtime/plugin/servers"
import {
  canHoldProjectRoute,
  canIndexServerSettings,
  createServerRetryState,
  isServerRetrying,
  isSettingsServerUnreachable,
  resolveServerAvailability,
  selectSettingsServerHealth,
  serverPagesConnection,
  transitionServerRetry,
  unauthorizedHttpServer,
  type ServerRetryEvent,
  type ServerRetryState,
} from "./machine"

const http: ServerConnection.Http = { type: "http", http: { url: "https://build.example.com" } }

const plugin = (status: ServerConnection.Plugin["status"]): ServerConnection.Plugin => ({
  type: "plugin",
  key: "ssh:build",
  plugin: "ssh",
  status,
  authenticate: () => false,
  managed: true,
  displayName: "Build server",
})

const source = (state: PluginServer["entry"]["state"]): PluginServer => ({
  key: "ssh:build",
  plugin: "ssh",
  entry: { id: "build", name: "Build server", state },
})

describe("settings server availability", () => {
  test("a signed-out or offline HTTP server is unavailable, so its project route leaves", () => {
    for (const input of [
      { connection: http, health: { type: "unauthorized" as const } },
      { connection: http, signedOut: true },
    ]) {
      const availability = resolveServerAvailability(input)
      expect(availability).toEqual({ status: "unauthorized", connection: http })
      expect(canHoldProjectRoute(availability.status)).toBe(false)
      expect(unauthorizedHttpServer(availability)).toBe(http)
    }

    const offline = resolveServerAvailability({ connection: http, health: { type: "unreachable" } })
    expect(offline).toEqual({ status: "unreachable", reason: "offline", connection: http })
    expect(canHoldProjectRoute(offline.status)).toBe(false)
  })

  test("a plugin server signing in stays starting, and one ready without an endpoint is unreachable", () => {
    // `authenticating` shows as starting on the connection while the plugin entry still reports `auth`.
    const signingIn = resolveServerAvailability({ connection: plugin({ type: "starting" }), source: source("auth") })
    expect(signingIn).toEqual({ status: "starting" })
    expect(canHoldProjectRoute(signingIn.status)).toBe(true)

    const missing = resolveServerAvailability({ connection: plugin({ type: "failed" }), source: source("ready") })
    expect(missing).toEqual({ status: "unreachable", reason: "offline" })
    expect(serverPagesConnection(missing)).toBeUndefined()
  })

  test("search indexes exactly the servers whose pages open", () => {
    const cases = [
      [{ connection: http }, true],
      [{ connection: http, health: { type: "checking" as const, managed: false } }, true],
      [{ connection: http, health: { type: "healthy" as const } }, true],
      [{ connection: http, health: { type: "unreachable" as const } }, false],
      [{ connection: http, health: { type: "unauthorized" as const } }, false],
      [{ connection: plugin({ type: "incompatible" }) }, false],
      [{ connection: plugin({ type: "starting" }) }, false],
    ] as const

    for (const [input, open] of cases) {
      const availability = resolveServerAvailability(input)
      expect(canIndexServerSettings(availability)).toBe(open)
      expect(serverPagesConnection(availability) !== undefined).toBe(open)
    }
  })

  test("the switcher calls a starting server connecting and an unprobed stopped one stopped", () => {
    const starting = resolveServerAvailability({ connection: plugin({ type: "starting" }) })
    expect(isSettingsServerUnreachable(starting)).toBe(false)
    expect(selectSettingsServerHealth(starting)).toEqual({ type: "starting" })

    const stopped = resolveServerAvailability({ source: source("stopped") })
    expect(selectSettingsServerHealth(stopped)).toEqual({ type: "stopped" })
    expect(isSettingsServerUnreachable(stopped)).toBe(true)

    expect(selectSettingsServerHealth(resolveServerAvailability({ connection: http }))).toBeUndefined()
  })
})

describe("settings server retry", () => {
  const a = ServerConnection.Key.make("https://a.example.com")
  const b = ServerConnection.Key.make("https://b.example.com")

  function run(events: readonly ServerRetryEvent[], state: ServerRetryState = createServerRetryState(a)) {
    return events.reduce<{ state: ServerRetryState; effects: unknown[] }>(
      (current, event) => {
        const next = transitionServerRetry(current.state, event)

        return { state: next.state, effects: [...next.effects] }
      },
      { state, effects: [] },
    )
  }

  test("switching servers re-enables Retry, and the first server's late answer cannot end the second's retry", () => {
    const first = run([{ type: "retry.clicked" }])
    expect(first.effects).toEqual([{ type: "retry.run", attempt: 1, timeoutMs: 35_000 }])

    const switched = run([{ type: "server.synced", server: b }], first.state)
    expect(switched.state).toEqual({ status: "idle", server: b, attempt: 1 })
    expect(switched.effects).toEqual([{ type: "timeout.cancel" }])
    expect(isServerRetrying(switched.state)).toBe(false)

    const second = run([{ type: "retry.clicked" }], switched.state)
    const late = transitionServerRetry(second.state, { type: "retry.settled", attempt: 1 })
    expect(late.state).toBe(second.state)
    expect(isServerRetrying(late.state)).toBe(true)

    expect(run([{ type: "retry.settled", attempt: 2 }], second.state)).toEqual({
      state: { status: "idle", server: b, attempt: 2 },
      effects: [{ type: "timeout.cancel" }],
    })
  })

  test("a retry whose probe hangs times out, and a second click while retrying is ignored", () => {
    const retrying = run([{ type: "retry.clicked" }])
    expect(transitionServerRetry(retrying.state, { type: "retry.clicked" }).state).toBe(retrying.state)
    expect(run([{ type: "retry.timed-out", attempt: 1 }], retrying.state)).toEqual({
      state: { status: "idle", server: a, attempt: 1 },
      effects: [],
    })
  })

  test("disposing cancels the timeout, and later answers change nothing", () => {
    const disposed = run([{ type: "retry.clicked" }, { type: "disposed" }])
    expect(disposed.effects).toEqual([{ type: "timeout.cancel" }])
    expect(transitionServerRetry(disposed.state, { type: "retry.settled", attempt: 1 }).state).toBe(disposed.state)
    const idle = createServerRetryState(a)
    expect(transitionServerRetry(idle, { type: "disposed" }).state).toBe(idle)
    expect(transitionServerRetry(idle, { type: "server.synced", server: a }).state).toBe(idle)
  })
})
