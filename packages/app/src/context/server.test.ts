import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createServerProjects,
  migrateCanonicalLocalServerState,
  nextServerAfterRemoval,
  RECENTLY_CLOSED_HISTORY_LIMIT,
  resolveServerList,
  ServerConnection,
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
  const emptyStore = () => ({ projects: {}, lastProject: {}, recentlyClosed: {}, hiddenClosed: {}, archivedClosed: {} })

  test("keeps active and explicit server buckets in one reactive store", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore(emptyStore())
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
      const [store, setStore] = createStore(emptyStore())
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
      const [store, setStore] = createStore(emptyStore())
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
      const [store, setStore] = createStore(emptyStore())
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
      const [store, setStore] = createStore(emptyStore())
      const projects = createServerProjects({ scope, store, setStore })

      const total = RECENTLY_CLOSED_HISTORY_LIMIT + 4
      for (let i = 1; i <= total; i++) {
        projects.open(`/p${i}`)
        projects.close(`/p${i}`)
      }
      expect(projects.recentlyClosed()).toHaveLength(RECENTLY_CLOSED_HISTORY_LIMIT)
      expect(projects.recentlyClosed()[0]).toBe(`/p${total}`)
      expect(projects.recentlyClosed().at(-1)).toBe("/p5")
      dispose()
    })
  })

  test("dedupes recently closed entries by normalized path", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore(emptyStore())
      const projects = createServerProjects({ scope, store, setStore })

      projects.close("/repo")
      projects.close("/repo/")
      expect(projects.recentlyClosed()).toEqual(["/repo/"])
      dispose()
    })
  })

  test("archives and restores closed projects", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore(emptyStore())
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/a")
      projects.close("/a")
      expect(projects.isArchivedClosed("/a")).toBe(false)

      projects.archiveClosed("/a")
      expect(projects.isArchivedClosed("/a")).toBe(true)
      expect(projects.archivedClosed()).toEqual(["/a"])

      projects.unarchiveClosed("/a")
      expect(projects.isArchivedClosed("/a")).toBe(false)
      expect(projects.archivedClosed()).toEqual([])
      // Unarchiving keeps history entry.
      expect(projects.recentlyClosed()).toEqual(["/a"])
      dispose()
    })
  })

  test("hides and unhides closed projects", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore(emptyStore())
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/a")
      projects.close("/a")
      projects.hideClosed("/a")
      expect(projects.isHiddenClosed("/a")).toBe(true)

      projects.unhideClosed("/a")
      expect(projects.isHiddenClosed("/a")).toBe(false)
      expect(projects.recentlyClosed()).toEqual(["/a"])
      dispose()
    })
  })

  test("reopening clears hidden and archived flags", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore(emptyStore())
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/a")
      projects.close("/a")
      projects.hideClosed("/a")
      projects.archiveClosed("/a")
      expect(projects.isHiddenClosed("/a")).toBe(true)
      expect(projects.isArchivedClosed("/a")).toBe(true)

      projects.open("/a")
      expect(projects.recentlyClosed()).toEqual([])
      expect(projects.isHiddenClosed("/a")).toBe(false)
      expect(projects.isArchivedClosed("/a")).toBe(false)
      dispose()
    })
  })

  test("re-closing makes a project visible again", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore(emptyStore())
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/a")
      projects.close("/a")
      projects.hideClosed("/a")
      projects.open("/a")
      projects.close("/a")
      expect(projects.isHiddenClosed("/a")).toBe(false)
      expect(projects.recentlyClosed()).toEqual(["/a"])
      dispose()
    })
  })

  test("forgetting removes history and flags without touching active projects", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore(emptyStore())
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/a")
      projects.close("/a")
      projects.hideClosed("/a")
      projects.archiveClosed("/a")
      projects.removeClosed("/a")
      expect(projects.recentlyClosed()).toEqual([])
      expect(projects.hiddenClosed()).toEqual([])
      expect(projects.archivedClosed()).toEqual([])

      // Forgetting unknown entries is a no-op for history but clears stray flags.
      projects.removeClosed("/missing")
      expect(projects.recentlyClosed()).toEqual([])
      dispose()
    })
  })

  test("reorders closed history without losing flags", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore(emptyStore())
      const projects = createServerProjects({ scope, store, setStore })

      for (const dir of ["/a", "/b", "/c"]) {
        projects.open(dir)
        projects.close(dir)
      }
      expect(projects.recentlyClosed()).toEqual(["/c", "/b", "/a"])
      projects.archiveClosed("/a")

      projects.moveClosed("/a", 0)
      expect(projects.recentlyClosed()).toEqual(["/a", "/c", "/b"])
      expect(projects.isArchivedClosed("/a")).toBe(true)
      dispose()
    })
  })

  test("prunes flags that fall out of the history window", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore(emptyStore())
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/old")
      projects.close("/old")
      projects.hideClosed("/old")
      expect(projects.isHiddenClosed("/old")).toBe(true)

      for (let i = 1; i <= RECENTLY_CLOSED_HISTORY_LIMIT; i++) {
        projects.open(`/p${i}`)
        projects.close(`/p${i}`)
      }
      expect(projects.recentlyClosed()).not.toContain("/old")
      expect(projects.isHiddenClosed("/old")).toBe(false)
      dispose()
    })
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
})
