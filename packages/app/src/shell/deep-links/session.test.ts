import { describe, expect, test } from "bun:test"
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
} from "./session"

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

    const opened = await openSessionDeepLink(
      { type: "session", sessionID: "ses_1", server: "https://untrusted.example.com" },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: async () => {
          fetched += 1

          return undefined
        },
      },
      recorder.tabs,
    )

    expect(opened).toBe(false)
    expect(fetched).toBe(0)
    expect(recorder.store).toEqual([])
    expect(recorder.selected).toEqual([])
  })

  test("resolves omitted ?server= by checking connected servers and falling back to active server", async () => {
    const sessions = new Map<string, DeepLinkSessionInfo>([[`${remoteKey}:ses_remote`, { id: "ses_remote" }]])

    const resolvedRemote = await resolveSessionDeepLink(
      { type: "session", sessionID: "ses_remote", server: undefined },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: async (server, sessionID) => sessions.get(`${server}:${sessionID}`),
      },
    )

    expect(resolvedRemote).toEqual({ server: remoteKey, session: { id: "ses_remote" } })

    const fallback = await resolveSessionDeepLink(
      { type: "session", sessionID: "ses_unknown", server: undefined },
      {
        servers: [sidecar, remote],
        activeServer: remoteKey,
        cached: () => undefined,
        fetch: async () => undefined,
      },
    )

    expect(fallback).toEqual({ server: remoteKey, session: undefined })
  })

  test("opens a subagent session nested under its root session tab", async () => {
    const recorder = createTabsRecorder()

    const sessions = new Map<string, DeepLinkSessionInfo>([
      ["ses_root", { id: "ses_root" }],
      ["ses_parent", { id: "ses_parent", parentID: "ses_root" }],
      ["ses_child", { id: "ses_child", parentID: "ses_parent" }],
    ])

    const opened = await openSessionDeepLink(
      { type: "session", sessionID: "ses_child", server: "http://100.73.96.98:4097/" },
      {
        servers: [sidecar, remote],
        activeServer: sidecarKey,
        cached: () => undefined,
        fetch: async (server, sessionID) => (server === remoteKey ? sessions.get(sessionID) : undefined),
      },
      recorder.tabs,
    )

    expect(opened).toBe(true)
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

    const opened = await openSessionDeepLink(
      { type: "session", sessionID: "ses_root", server: undefined },
      {
        servers: [sidecar],
        activeServer: sidecarKey,
        cached: (_server, sessionID) => (sessionID === "ses_root" ? { id: "ses_root" } : undefined),
        fetch: async () => undefined,
      },
      recorder.tabs,
    )

    expect(opened).toBe(true)
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
  test("drains queued links on mount, handles live links, and unsubscribes on cleanup", async () => {
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
    const [sessionsReady, setSessionsReady] = createSignal(false)

    let wait!: () => Promise<void>

    const dispose = createRoot((dispose) => {
      const driver = createDeepLinksDriver({
        onDeepLinks,
        directoryReady: () => false,
        sessionsReady,
        ask: () => {},
        openDirectory: async () => {},
        openSession: async (link) => {
          await openSessionDeepLink(
            link,
            {
              servers: [sidecar, remote],
              activeServer: sidecarKey,
              cached: () => undefined,
              fetch: async (server, sessionID) =>
                server === sidecarKey && sessionID === "ses_live" ? { id: "ses_live" } : undefined,
            },
            recorder.tabs,
          )
        },
      })

      wait = driver.pending

      return dispose
    })

    // Queued link was drained from pending immediately on mount, and waits for servers to become ready.
    expect(pending).toEqual([])
    expect(recorder.selected).toEqual([])

    setSessionsReady(true)
    await wait()

    expect(recorder.selected).toEqual([
      {
        type: "session",
        server: remoteKey,
        sessionId: "ses_queued",
        routeSessionId: undefined,
        routeParentId: undefined,
      },
    ])

    // Live link opens immediately while mounted; non-session and unknown-server links are ignored.
    listeners.forEach((listener) =>
      listener([
        "opencode://console/authorized?window=a",
        "opencode://session/ses_bad?server=https%3A%2F%2Fevil.example.com",
        "opencode://session/ses_live",
      ]),
    )
    await wait()

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

    // Cleanup unsubscribes so subsequent links are not handled by the disposed driver.
    dispose()
    expect(listeners.size).toBe(0)
    listeners.forEach((listener) => listener(["opencode://session/ses_after_dispose"]))
    await wait()
    expect(recorder.selected).toHaveLength(2)
  })
})
