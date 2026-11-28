import { afterEach, describe, expect, jest, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { ServerConnection } from "@/runtime/server/registry"
import type { SessionTab, Tab } from "@/shell/tabs/tabs"
import { createDeepLinksDriver } from "./deep-links"
import {
  matchConfiguredServer,
  openSessionDeepLink,
  resolveSessionDeepLink,
  type DeepLinkSessionInfo,
  type SessionDeepLinkTabs,
  type SessionFetchResult,
} from "./session"

afterEach(() => {
  jest.useRealTimers()
})

const sidecar: ServerConnection.Sidecar = {
  type: "sidecar",
  variant: "base",
  http: { url: "http://127.0.0.1:4096" },
}

const remote: ServerConnection.Http = {
  type: "http",
  http: { url: "http://100.73.96.98:4097" },
}

const pluginReady: ServerConnection.Plugin = {
  type: "plugin",
  key: "ssh:devbox",
  plugin: "ssh",
  managed: true,
  status: { type: "ready", http: { url: "http://127.0.0.1:51234" } },
  authenticate: () => false,
}

const pluginStopped: ServerConnection.Plugin = {
  type: "plugin",
  key: "ssh:offline",
  plugin: "ssh",
  managed: true,
  status: { type: "stopped" },
  authenticate: () => false,
}

const sidecarKey = ServerConnection.key(sidecar)

const remoteKey = ServerConnection.key(remote)

const pluginKey = ServerConnection.key(pluginReady)

function createTabsRecorder(initial: SessionTab[] = []) {
  const store: SessionTab[] = initial.map((tab) => ({ ...tab }))
  const selected: SessionTab[] = []

  const tabs: SessionDeepLinkTabs = {
    addSessionTab: (input) => {
      const existing = store.find((tab) => tab.server === input.server && tab.sessionId === input.sessionId)

      if (existing) return existing
      const next: SessionTab = { type: "session", ...input }
      store.push(next)

      return next
    },
    rememberSessionRoute: (tab, sessionId, parentId) => {
      const existing = store.find((item) => item.server === tab.server && item.sessionId === tab.sessionId)

      if (!existing) return
      existing.routeSessionId = sessionId === existing.sessionId ? undefined : sessionId
      existing.routeParentId = sessionId === existing.sessionId ? undefined : parentId
    },
    select: (tab: Tab) => {
      if (tab.type === "session") selected.push({ ...tab })
    },
  }

  return { tabs, store, selected }
}

function foundOrNotFound(session: DeepLinkSessionInfo | undefined): SessionFetchResult {
  return session ? { status: "found", session } : { status: "not-found" }
}

function createWaiter() {
  const waiters: Array<() => void> = []

  return {
    notify() {
      waiters.splice(0).forEach((resolve) => resolve())
    },
    until(predicate: () => boolean) {
      if (predicate()) return Promise.resolve()

      return new Promise<void>((resolve) => {
        const check = () => {
          if (predicate()) return resolve()
          waiters.push(check)
        }

        waiters.push(check)
      })
    },
  }
}

describe("session deep link server resolution", () => {
  const servers: ServerConnection.Any[] = [sidecar, remote, pluginReady, pluginStopped]

  test.each([
    { url: "http://100.73.96.98:4097", expected: remoteKey },
    { url: "http://100.73.96.98:4097/", expected: remoteKey },
    { url: "HTTP://100.73.96.98:4097///", expected: remoteKey },
    { url: "http://127.0.0.1:4096", expected: sidecarKey },
    { url: "http://localhost:4096/", expected: sidecarKey },
    { url: "http://[::1]:4096", expected: sidecarKey },
    { url: "http://127.0.0.1:51234", expected: pluginKey },
    { url: "http://100.73.96.98:4098", expected: undefined },
    { url: "https://evil.example.com", expected: undefined },
    { url: "http://100.73.96.98:4097/other", expected: undefined },
  ])("matches $url -> $expected", ({ url, expected }) => {
    expect(matchConfiguredServer(url, servers)).toBe(expected)
  })

  test("rejects unknown ?server= without opening any tab", async () => {
    const recorder = createTabsRecorder()
    let fetched = 0

    const outcome = await openSessionDeepLink(
      { type: "session", sessionID: "ses_1", server: "https://untrusted.example.com" },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: async () => {
          fetched += 1

          return { status: "not-found" }
        },
      },
      recorder.tabs,
    )

    expect(outcome).toEqual({ status: "unknown-server" })
    expect(fetched).toBe(0)
    expect(recorder.store).toEqual([])
    expect(recorder.selected).toEqual([])
  })

  test("does not open a broken tab when explicit ?server= reports not-found, but opens when transiently unavailable", async () => {
    const notFoundRecorder = createTabsRecorder()

    const notFound = await openSessionDeepLink(
      { type: "session", sessionID: "ses_missing", server: "http://100.73.96.98:4097" },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: async () => ({ status: "not-found" }),
      },
      notFoundRecorder.tabs,
    )

    expect(notFound).toEqual({ status: "not-found" })
    expect(notFoundRecorder.store).toEqual([])
    expect(notFoundRecorder.selected).toEqual([])

    const unavailableRecorder = createTabsRecorder()

    const unavailable = await openSessionDeepLink(
      { type: "session", sessionID: "ses_offline", server: "http://100.73.96.98:4097" },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: async () => ({ status: "unavailable" }),
      },
      unavailableRecorder.tabs,
    )

    expect(unavailable).toEqual({ status: "opened", server: remoteKey, session: undefined })
    expect(unavailableRecorder.selected).toEqual([
      {
        type: "session",
        server: remoteKey,
        sessionId: "ses_offline",
        routeSessionId: undefined,
        routeParentId: undefined,
      },
    ])
  })

  test("resolves omitted ?server= by checking configured servers and does not open a tab when none own it", async () => {
    const sessions = new Map<string, DeepLinkSessionInfo>([[`${remoteKey}:ses_remote`, { id: "ses_remote" }]])

    const resolvedRemote = await resolveSessionDeepLink(
      { type: "session", sessionID: "ses_remote", server: undefined },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: async (server, sessionID) => foundOrNotFound(sessions.get(`${server}:${sessionID}`)),
      },
    )

    expect(resolvedRemote).toEqual({ status: "found", server: remoteKey, session: { id: "ses_remote" } })

    const recorder = createTabsRecorder()

    const missing = await openSessionDeepLink(
      { type: "session", sessionID: "ses_unknown", server: undefined },
      {
        servers: [sidecar, remote],
        activeServer: remoteKey,
        cached: () => undefined,
        fetch: async () => ({ status: "not-found" }),
      },
      recorder.tabs,
    )

    expect(missing).toEqual({ status: "not-found" })
    expect(recorder.store).toEqual([])
    expect(recorder.selected).toEqual([])
  })

  test("resolves immediately when one server finds the session without waiting for another hanging server", async () => {
    jest.useFakeTimers()
    const recorder = createTabsRecorder()
    let hangingSignal: AbortSignal | undefined

    const outcome = await openSessionDeepLink(
      { type: "session", sessionID: "ses_fast", server: undefined },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: (server, sessionID, signal) => {
          if (server === sidecarKey) {
            hangingSignal = signal

            return new Promise(() => {})
          }

          return Promise.resolve(foundOrNotFound(sessionID === "ses_fast" ? { id: "ses_fast" } : undefined))
        },
      },
      recorder.tabs,
    )

    // Resolved without advancing fake timers, and aborted the hanging server's probe immediately.
    expect(hangingSignal?.aborted).toBe(true)
    expect(outcome).toEqual({ status: "opened", server: remoteKey, session: { id: "ses_fast" } })
    expect(recorder.selected).toEqual([
      {
        type: "session",
        server: remoteKey,
        sessionId: "ses_fast",
        routeSessionId: undefined,
        routeParentId: undefined,
      },
    ])
  })

  test("aborts all hanging server lookups when the timeout expires", async () => {
    jest.useFakeTimers()
    const recorder = createTabsRecorder()
    const signals: AbortSignal[] = []

    const pending = openSessionDeepLink(
      { type: "session", sessionID: "ses_hung", server: undefined },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: (_server, _sessionID, signal) => {
          signals.push(signal)

          return new Promise(() => {})
        },
      },
      recorder.tabs,
    )

    expect(signals.every((signal) => !signal.aborted)).toBe(true)
    jest.advanceTimersToNextTimer()

    const outcome = await pending

    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(outcome).toEqual({ status: "not-found" })
    expect(recorder.selected).toEqual([])
  })

  test("opens a subagent session nested under its root session tab", async () => {
    const recorder = createTabsRecorder()

    const sessions = new Map<string, DeepLinkSessionInfo>([
      ["ses_root", { id: "ses_root" }],
      ["ses_parent", { id: "ses_parent", parentID: "ses_root" }],
      ["ses_child", { id: "ses_child", parentID: "ses_parent" }],
    ])

    const outcome = await openSessionDeepLink(
      { type: "session", sessionID: "ses_child", server: "http://100.73.96.98:4097/" },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: async (server, sessionID) => foundOrNotFound(server === remoteKey ? sessions.get(sessionID) : undefined),
      },
      recorder.tabs,
    )

    expect(outcome).toEqual({
      status: "opened",
      server: remoteKey,
      session: { id: "ses_child", parentID: "ses_parent" },
    })
    expect(recorder.store).toEqual([
      {
        type: "session",
        server: remoteKey,
        sessionId: "ses_root",
        routeSessionId: "ses_child",
        routeParentId: "ses_parent",
      },
    ])
    expect(recorder.selected).toEqual([
      {
        type: "session",
        server: remoteKey,
        sessionId: "ses_root",
        routeSessionId: "ses_child",
        routeParentId: "ses_parent",
      },
    ])
  })

  test("does not open a standalone root tab for a subagent session when its ancestor lookup fails", async () => {
    const recorder = createTabsRecorder()

    const outcome = await openSessionDeepLink(
      { type: "session", sessionID: "ses_orphan_child", server: "http://100.73.96.98:4097" },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: async (_server, sessionID) =>
          sessionID === "ses_orphan_child"
            ? { status: "found", session: { id: "ses_orphan_child", parentID: "ses_missing_parent" } }
            : { status: "not-found" },
      },
      recorder.tabs,
    )

    expect(outcome).toEqual({ status: "not-found" })
    expect(recorder.store).toEqual([])
    expect(recorder.selected).toEqual([])
  })

  test("opening a root session clears a previously remembered child route on that tab", async () => {
    const recorder = createTabsRecorder([
      {
        type: "session",
        server: sidecarKey,
        sessionId: "ses_root",
        routeSessionId: "ses_child",
        routeParentId: "ses_root",
      },
    ])

    const outcome = await openSessionDeepLink(
      { type: "session", sessionID: "ses_root", server: undefined },
      {
        servers: [sidecar],
        activeServer: sidecarKey,
        cached: (_server, sessionID) => (sessionID === "ses_root" ? { id: "ses_root" } : undefined),
        fetch: async () => ({ status: "not-found" }),
      },
      recorder.tabs,
    )

    expect(outcome).toEqual({ status: "opened", server: sidecarKey, session: { id: "ses_root" } })
    expect(recorder.store).toEqual([
      {
        type: "session",
        server: sidecarKey,
        sessionId: "ses_root",
        routeSessionId: undefined,
        routeParentId: undefined,
      },
    ])
    expect(recorder.selected).toEqual([
      {
        type: "session",
        server: sidecarKey,
        sessionId: "ses_root",
        routeSessionId: undefined,
        routeParentId: undefined,
      },
    ])
  })
})

describe("deep link driver integration", () => {
  test("drains queued links on cold launch, handles live links, and aborts in-flight work on dispose", async () => {
    const pending = ["opencode://session/ses_queued?server=http%3A%2F%2F100.73.96.98%3A4097%2F"]
    const listeners = new Set<(urls: string[]) => void>()

    const onDeepLinks = (listener: (urls: string[]) => void) => {
      listeners.add(listener)
      const queued = pending.splice(0)

      if (queued.length) listener(queued)

      return () => {
        listeners.delete(listener)
      }
    }

    const recorder = createTabsRecorder()
    const [hydrated, setHydrated] = createSignal(false)
    const waiter = createWaiter()
    const handled: string[] = []
    let inFlightSignal: AbortSignal | undefined
    let resolveInFlight: ((result: SessionFetchResult) => void) | undefined

    const dispose = createRoot((dispose) => {
      createDeepLinksDriver({
        onDeepLinks,
        directoryReady: () => false,
        // Cold launch: HTTP endpoint is configured even if SSE is still connecting.
        sessionsReady: () => hydrated() && [sidecar, remote].some((conn) => !!ServerConnection.http(conn)),
        ask: () => {},
        openDirectory: async () => {},
        openSession: async (link, signal) => {
          await openSessionDeepLink(
            link,
            {
              servers: [sidecar, remote],
              activeServer: sidecarKey,
              cached: () => undefined,
              fetch: async (server, sessionID, fetchSignal) => {
                if (sessionID === "ses_inflight") {
                  inFlightSignal = fetchSignal
                  waiter.notify()

                  return new Promise<SessionFetchResult>((resolve) => {
                    resolveInFlight = resolve
                  })
                }

                if (server === remoteKey && sessionID === "ses_queued")
                  return { status: "found", session: { id: "ses_queued" } }

                if (server === sidecarKey && sessionID === "ses_live")
                  return { status: "found", session: { id: "ses_live" } }

                return { status: "not-found" }
              },
            },
            recorder.tabs,
            signal,
          )
          handled.push(link.sessionID)
          waiter.notify()
        },
      })

      return dispose
    })

    // Queued link was drained from pending immediately on mount, and waits for servers to hydrate.
    expect(pending).toEqual([])
    expect(recorder.selected).toEqual([])

    setHydrated(true)
    await waiter.until(() => handled.includes("ses_queued"))

    expect(recorder.selected).toEqual([
      {
        type: "session",
        server: remoteKey,
        sessionId: "ses_queued",
        routeSessionId: undefined,
        routeParentId: undefined,
      },
    ])

    // Live link opens immediately while mounted; non-session, unknown-server, and missing links are ignored.
    listeners.forEach((listener) =>
      listener([
        "opencode://console/authorized?window=a",
        "opencode://session/ses_bad?server=https%3A%2F%2Fevil.example.com",
        "opencode://session/ses_missing",
        "opencode://session/ses_live",
      ]),
    )
    await waiter.until(() => handled.includes("ses_live"))

    expect(recorder.selected).toEqual([
      {
        type: "session",
        server: remoteKey,
        sessionId: "ses_queued",
        routeSessionId: undefined,
        routeParentId: undefined,
      },
      {
        type: "session",
        server: sidecarKey,
        sessionId: "ses_live",
        routeSessionId: undefined,
        routeParentId: undefined,
      },
    ])

    // Start an in-flight lookup, then dispose before it settles: signal aborts and no tab is opened.
    listeners.forEach((listener) =>
      listener(["opencode://session/ses_inflight?server=http%3A%2F%2F100.73.96.98%3A4097"]),
    )
    await waiter.until(() => inFlightSignal !== undefined)
    expect(inFlightSignal?.aborted).toBe(false)

    dispose()
    expect(listeners.size).toBe(0)
    expect(inFlightSignal?.aborted).toBe(true)

    resolveInFlight?.({ status: "found", session: { id: "ses_inflight" } })
    await waiter.until(() => handled.includes("ses_inflight"))
    expect(recorder.selected).toHaveLength(2)
  })
})
