import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import {
  migrateCanonicalLocalServerState,
  migrateServerAuthState,
  resolveServerList,
  ServerConnection,
} from "./registry"
import { ServerScope } from "@/runtime/server/scope"

describe("migrateServerAuthState", () => {
  test("removes legacy usernames without changing passwords or other saved state", () => {
    const state = {
      list: [
        "http://localhost:4096",
        { url: "https://flat.example", username: "legacy", password: "first" },
        {
          type: "http",
          displayName: "Remote",
          http: { url: "https://nested.example", username: "legacy", password: "second" },
        },
      ],
      projects: { local: [{ worktree: "/project", expanded: true }] },
    }
    expect(migrateServerAuthState(state)).toEqual({
      ...state,
      list: [
        "http://localhost:4096",
        { url: "https://flat.example", password: "first" },
        { type: "http", displayName: "Remote", http: { url: "https://nested.example", password: "second" } },
      ],
    })
    expect(state.list[1]).toHaveProperty("username", "legacy")
    expect(migrateServerAuthState(migrateServerAuthState(state))).toEqual(migrateServerAuthState(state))
  })

  test("preserves absent or malformed lists", () => {
    expect(migrateServerAuthState(undefined)).toBeUndefined()
    expect(migrateServerAuthState({ projects: {} })).toEqual({ projects: {} })
    expect(migrateServerAuthState({ list: [null, 1, {}] })).toEqual({ list: [null, 1, {}] })
  })
})

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
            password: "secret",
          },
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
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
          password: "saved",
        },
      ],
      props: [{ type: "http", http: { url: "https://server.example.test" } }],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
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
