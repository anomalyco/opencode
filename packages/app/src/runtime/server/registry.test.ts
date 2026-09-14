import { describe, expect, test } from "bun:test"
import { canRemoveServer, createServerProjects, resolveServerList, ServerConnection } from "./registry"
import { Schema } from "effect"
import { serverState } from "./persistence"
import { createStore } from "solid-js/store"
import { ServerScope } from "./scope"
import { Persistence } from "@/runtime/persistence/schema"

function serverSchema() {
  return Persistence.withInitial(serverState(), {
    list: [],
    hidden: {},
    projects: {},
    lastProject: {},
    recentlyClosed: {},
  })
}

describe("resolveServerList", () => {
  test("lets startup auth_token credentials override a persisted same-url server", () => {
    const list = resolveServerList({
      stored: Schema.decodeUnknownSync(serverSchema())({ list: [{ url: "https://server.example.test" }] }).list,
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
    expect(list[0] && String(ServerConnection.key(list[0]))).toBe("https://server.example.test")
  })

  test("keeps persisted credentials when startup has no auth_token", () => {
    const list = resolveServerList({
      stored: Schema.decodeUnknownSync(serverSchema())({
        list: [{ url: "https://server.example.test", password: "saved" }],
      }).list,
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

test("keeps exact persisted server identities and prevents removing provided servers", () => {
  const stored = Schema.decodeUnknownSync(serverSchema())({
    list: ["http://localhost:4096", "http://localhost:4096/", "http://127.0.0.1:4096"],
  }).list
  expect(resolveServerList({ stored }).map((server) => String(ServerConnection.key(server)))).toEqual([
    "http://localhost:4096",
    "http://localhost:4096/",
    "http://127.0.0.1:4096",
  ])
  const key = ServerConnection.Key.make("http://localhost:4096")
  expect(canRemoveServer({ key, stored })).toBe(true)
  expect(canRemoveServer({ key, stored, provided: [{ type: "http", http: { url: key } }] })).toBe(false)
})

test("project actions update schema-derived state and follow dynamic server scopes", () => {
  const [store, setStore] = createStore(Schema.decodeUnknownSync(serverSchema())({}))
  const props: { server: ServerConnection.Key; canonicalLocalServer?: ServerConnection.Key } = {
    server: ServerConnection.Key.make("https://remote.example"),
  }
  const projects = createServerProjects({
    store,
    setStore,
    scope: () => ServerScope.fromServerKey(props.server, props.canonicalLocalServer),
  })
  projects.open("/remote")
  projects.collapse("/remote")
  projects.touch("/remote")
  expect(projects.list()).toEqual([{ worktree: "/remote", expanded: false }])
  expect(projects.last()).toBe("/remote")
  props.canonicalLocalServer = props.server
  expect(projects.list()).toEqual([])
  projects.open("/local")
  projects.close("/local")
  expect(projects.recentlyClosed()).toEqual(["/local"])
  projects.open("/local")
  expect(projects.recentlyClosed()).toEqual([])
  expect(store.projects.local).toEqual([{ worktree: "/local", expanded: true }])
  expect(store.projects[props.server]).toEqual([{ worktree: "/remote", expanded: false }])
})
