import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import {
  clearServerProjectScope,
  createServerProjects,
  migrateCanonicalLocalServerState,
  nextServerAfterRemoval,
  resolveServerList,
  ServerConnection,
  visibleProjectEntries,
} from "./server"
import { ServerScope } from "@/utils/server-scope"

describe("resolveServerList", () => {
  test("lets startup auth_token credentials override a persisted same-url server", () => {
    const list = resolveServerList({
      stored: [{ url: "https://server.example.test" }],
      props: [
        {
          type: "http",
          authToken: true,
          http: {
            url: "https://server.example.test",
            username: "opencode",
            password: "secret",
          },
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "opencode",
      password: "secret",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : false).toBe(true)
    expect(ServerConnection.key(list[0]!) as string).toBe("https://server.example.test")
  })

  test("keeps persisted credentials when startup has no auth_token", () => {
    const list = resolveServerList({
      stored: [
        {
          url: "https://server.example.test",
          username: "opencode",
          password: "saved",
        },
      ],
      props: [{ type: "http", http: { url: "https://server.example.test" } }],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "opencode",
      password: "saved",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : true).toBeUndefined()
  })
})

test("treats WSL sidecars as remote server connections", () => {
  expect(
    ServerConnection.local({
      type: "sidecar",
      variant: "wsl",
      distro: "Debian",
      http: { url: "http://127.0.0.1:4097" },
    }),
  ).toBe(false)
  expect(ServerConnection.local({ type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } })).toBe(
    true,
  )
  expect(ServerConnection.local({ type: "http", http: { url: "http://localhost:4096" } })).toBe(true)
  expect(ServerConnection.local({ type: "http", http: { url: "https://server.example.test" } })).toBe(false)
})

test("active server removal falls back across built-in and persisted servers", () => {
  const local = { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } } as const
  const debian = {
    type: "sidecar",
    variant: "wsl",
    distro: "Debian",
    http: { url: "http://127.0.0.1:4097" },
  } as const

  expect(
    nextServerAfterRemoval(
      [local, debian],
      ServerConnection.Key.make("wsl:Debian"),
      ServerConnection.Key.make("sidecar"),
    ),
  ).toBe(ServerConnection.Key.make("sidecar"))
})

describe("createServerProjects", () => {
  test("keeps active and explicit server buckets in one reactive store", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const active = createServerProjects({ scope, store, setStore })
      const remote = createServerProjects({ scope: () => "https://debian.example" as ServerScope, store, setStore })

      remote.open("/repo")
      expect(remote.list()).toEqual([{ worktree: "/repo", expanded: true }])
      expect(active.list()).toEqual([])

      const adopted = createServerProjects({ scope: () => "https://debian.example" as ServerScope, store, setStore })
      expect(adopted.list()).toEqual([{ worktree: "/repo", expanded: true }])

      adopted.close("/repo")
      expect(remote.list()).toEqual([])
      dispose()
    })
  })

  test("tracks recently closed projects and drops them when reopened", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/a")
      projects.open("/b")
      projects.close("/a")
      expect(projects.recentlyClosed()).toEqual(["/a"])

      projects.close("/b")
      expect(projects.recentlyClosed()).toEqual(["/b", "/a"])

      projects.open("/a")
      expect(projects.recentlyClosed()).toEqual(["/b"])
      expect(projects.list()).toEqual([{ worktree: "/a", expanded: true }])
      dispose()
    })
  })

  test("remove drops a project without recording it as recently closed", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/repo/subdir")
      projects.remove("/repo/subdir")
      expect(projects.list()).toEqual([])
      expect(projects.recentlyClosed()).toEqual([])
      dispose()
    })
  })

  test("retains recently closed history beyond the visible display limit", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      // Closing 6 projects keeps all 6 in the store even though only 5 are displayed;
      // this prevents display-filtered entries from evicting still-visible ones.
      for (const dir of ["/1", "/2", "/3", "/4", "/5", "/6"]) {
        projects.open(dir)
        projects.close(dir)
      }
      expect(projects.recentlyClosed()).toEqual(["/6", "/5", "/4", "/3", "/2", "/1"])
      dispose()
    })
  })

  test("caps recently closed history at the store limit", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      for (let i = 1; i <= 20; i++) {
        projects.open(`/p${i}`)
        projects.close(`/p${i}`)
      }
      expect(projects.recentlyClosed()).toHaveLength(16)
      expect(projects.recentlyClosed()[0]).toBe("/p20")
      expect(projects.recentlyClosed().at(-1)).toBe("/p5")
      dispose()
    })
  })

  test("dedupes recently closed entries by normalized path", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.close("/repo")
      projects.close("/repo/")
      expect(projects.recentlyClosed()).toEqual(["/repo/"])
      dispose()
    })
  })

  test("keeps hidden projects isolated per server and restores them when reopened", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({
        projects: {},
        lastProject: {},
        recentlyClosed: {},
        hiddenProjects: {},
      })
      const local = createServerProjects({ scope: () => ServerScope.local, store, setStore })
      const remote = createServerProjects({ scope: () => "https://debian.example" as ServerScope, store, setStore })

      remote.close("/repo")
      expect(remote.hidden()).toEqual(["/repo"])
      expect(local.hidden()).toEqual([])

      remote.open("/repo/")
      expect(remote.hidden()).toEqual([])
      dispose()
    })
  })

  test("normalizes bookmark mutations and removes every duplicate on close", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({
        projects: {
          local: [
            { worktree: "/repo", expanded: true },
            { worktree: "/repo/", expanded: false },
          ],
        },
        lastProject: {},
        recentlyClosed: {},
        hiddenProjects: {},
      })
      const projects = createServerProjects({ scope: () => ServerScope.local, store, setStore })

      projects.open("/repo/")
      expect(projects.list()).toHaveLength(2)

      projects.close("/repo")
      expect(projects.list()).toEqual([])
      expect(projects.hidden()).toEqual(["/repo"])
      dispose()
    })
  })

  test("prunes hidden projects against current server discovery", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({
        projects: {},
        lastProject: {},
        recentlyClosed: {},
        hiddenProjects: { local: ["/repo/a", "/repo/b", "/repo/b/"] },
      })
      const projects = createServerProjects({ scope: () => ServerScope.local, store, setStore })

      projects.reconcileHidden(["/repo/b"])
      expect(projects.hidden()).toEqual(["/repo/b"])
      dispose()
    })
  })
})

describe("clearServerProjectScope", () => {
  test("clears every organization bucket for a removed remote server", () => {
    const scope = ServerScope.fromServerKey(ServerConnection.Key.make("https://opencode.example.com"))
    const [store, setStore] = createStore({
      projects: { [scope]: [{ worktree: "/repo", expanded: true }], local: [{ worktree: "/local", expanded: true }] },
      lastProject: { [scope]: "/repo", local: "/local" },
      recentlyClosed: { [scope]: ["/closed"], local: ["/local-closed"] },
      hiddenProjects: { [scope]: ["/hidden"], local: ["/local-hidden"] },
    })

    clearServerProjectScope({ scope, store, setStore })

    expect(store).toEqual({
      projects: { local: [{ worktree: "/local", expanded: true }] },
      lastProject: { local: "/local" },
      recentlyClosed: { local: ["/local-closed"] },
      hiddenProjects: { local: ["/local-hidden"] },
    })
  })

  test("does not clear the shared canonical local bucket", () => {
    const [store, setStore] = createStore({
      projects: { local: [{ worktree: "/local", expanded: true }] },
      lastProject: { local: "/local" },
      recentlyClosed: { local: ["/closed"] },
      hiddenProjects: { local: ["/hidden"] },
    })

    clearServerProjectScope({ scope: ServerScope.local, store, setStore })
    expect(store.projects.local).toHaveLength(1)
    expect(store.hiddenProjects.local).toEqual(["/hidden"])
  })
})

describe("visibleProjectEntries", () => {
  test("discovers server projects for a fresh client", () => {
    expect(visibleProjectEntries([], [{ worktree: "/repo/a" }, { worktree: "/repo/b" }], [])).toEqual([
      { worktree: "/repo/a", expanded: false },
      { worktree: "/repo/b", expanded: false },
    ])
  })

  test("keeps remaining server projects after the first bookmark", () => {
    expect(
      visibleProjectEntries(
        [{ worktree: "/repo/a", expanded: true }],
        [{ worktree: "/repo/a" }, { worktree: "/repo/b" }],
        [],
      ),
    ).toEqual([
      { worktree: "/repo/a", expanded: true },
      { worktree: "/repo/b", expanded: false },
    ])
  })

  test("dedupes normalized paths while preserving bookmark order", () => {
    expect(
      visibleProjectEntries(
        [
          { worktree: "/repo/b", expanded: true },
          { worktree: "/repo/a/", expanded: false },
        ],
        [{ worktree: "/repo/a" }, { worktree: "/repo/c" }, { worktree: "/repo/b/" }],
        [],
      ),
    ).toEqual([
      { worktree: "/repo/b", expanded: true },
      { worktree: "/repo/a/", expanded: false },
      { worktree: "/repo/c", expanded: false },
    ])
  })

  test("filters hidden discoveries without hiding explicit bookmarks", () => {
    expect(
      visibleProjectEntries(
        [{ worktree: "/repo/a", expanded: true }],
        [{ worktree: "/repo/a" }, { worktree: "/repo/b" }],
        ["/repo/a/", "/repo/b/"],
      ),
    ).toEqual([{ worktree: "/repo/a", expanded: true }])
  })

  test("ignores malformed persisted hidden entries", () => {
    expect(visibleProjectEntries([], [{ worktree: "/repo/a" }], [null, 42, "/repo/b"] as unknown as string[])).toEqual([
      { worktree: "/repo/a", expanded: false },
    ])
  })

  test("preserves explicit local bookmarks that are absent from server discovery", () => {
    expect(visibleProjectEntries([{ worktree: "/manual", expanded: true }], [], [])).toEqual([
      { worktree: "/manual", expanded: true },
    ])
  })
})

describe("migrateCanonicalLocalServerState", () => {
  test("moves an existing canonical web bucket into local scope", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          list: [],
          projects: { "https://opencode.example.com": [{ worktree: "/remote", expanded: true }] },
          lastProject: { "https://opencode.example.com": "/remote" },
        },
        ServerConnection.Key.make("https://opencode.example.com"),
      ),
    ).toEqual({
      list: [],
      projects: { local: [{ worktree: "/remote", expanded: true }] },
      lastProject: { local: "/remote" },
    })
  })

  test("preserves existing local state while merging a canonical web bucket", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          projects: {
            local: [{ worktree: "/local", expanded: false }],
            "https://opencode.example.com": [
              { worktree: "/local", expanded: true },
              { worktree: "/remote", expanded: true },
            ],
          },
          lastProject: { local: "/local", "https://opencode.example.com": "/remote" },
        },
        ServerConnection.Key.make("https://opencode.example.com"),
      ),
    ).toEqual({
      projects: {
        local: [
          { worktree: "/local", expanded: false },
          { worktree: "/remote", expanded: true },
        ],
      },
      lastProject: { local: "/local" },
    })
  })

  test("moves hidden projects from a canonical web bucket into local scope", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          hiddenProjects: {
            local: ["/local-hidden"],
            "https://opencode.example.com": ["/local-hidden/", "/remote-hidden"],
          },
        },
        ServerConnection.Key.make("https://opencode.example.com"),
      ),
    ).toEqual({
      hiddenProjects: { local: ["/local-hidden", "/remote-hidden"] },
    })
  })

  test("drops malformed hidden projects during canonical migration", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          hiddenProjects: {
            local: ["/local-hidden", null],
            "https://opencode.example.com": [42, "/remote-hidden"],
          },
        },
        ServerConnection.Key.make("https://opencode.example.com"),
      ),
    ).toEqual({
      hiddenProjects: { local: ["/local-hidden", "/remote-hidden"] },
    })
  })
})
