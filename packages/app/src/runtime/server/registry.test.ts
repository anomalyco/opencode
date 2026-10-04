import { expect, test } from "bun:test"
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

test("startup auth_token credentials override a persisted same-url server; without one the persisted password stays", () => {
  const url = "https://server.example.test"
  const decode = Schema.decodeUnknownSync(serverSchema())
  const override = resolveServerList({
    stored: decode({ list: [{ url }] }).list,
    props: [{ type: "http", authToken: true, http: { url, password: "secret" } }],
  })
  expect(override).toEqual([{ type: "http", authToken: true, http: { url, password: "secret" } }])
  expect(String(ServerConnection.key(override[0]!))).toBe(url)

  const kept = resolveServerList({
    stored: decode({ list: [{ url, password: "saved" }] }).list,
    props: [{ type: "http", http: { url } }],
  })
  expect(kept).toHaveLength(1)
  expect(kept[0]?.http).toEqual({ url, password: "saved" })
  expect(kept[0]?.type === "http" ? kept[0].authToken : true).toBeUndefined()
})

test("treats WSL sidecars as remote server connections", () => {
  expect(
    ServerConnection.local({
      type: "extension",
      key: "wsl:Debian",
      extension: "wsl",
      state: "ready",
      connecting: false,
      authenticationRequired: false,
      managed: false,
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
