import { expect, test } from "bun:test"
import { canRemoveServer, createServerProjects, resolveServerList, ServerConnection, serverLabel } from "./registry"
import { Schema } from "effect"
import { ServerState } from "./persistence"
import { createStore } from "solid-js/store"
import { ServerScope } from "./scope"
import { Persistence } from "@/runtime/persistence/schema"

function serverSchema() {
  return Persistence.withInitial(ServerState, {
    list: [],
    hidden: {},
    lastProjectID: {},
    usedProjectIDs: {},
    hostnames: {},
    projects: {},
  })
}

test("the current server is named by its hostname, a custom name wins, and other servers show their address", () => {
  const sidecar: ServerConnection.Sidecar = { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } }
  const remote: ServerConnection.Http = { type: "http", http: { url: "https://apollo.example.test:4096/" } }
  const current = { hostname: "hailmary", fallback: "This computer" }

  expect(serverLabel(sidecar, current)).toBe("hailmary")
  expect(serverLabel(sidecar, { fallback: "This computer" })).toBe("This computer")
  expect(serverLabel(sidecar, { hostname: "", fallback: "This computer" })).toBe("This computer")
  expect(serverLabel({ ...sidecar, displayName: "Studio" }, current)).toBe("Studio")
  expect(serverLabel(remote)).toBe("apollo.example.test:4096")
  expect(serverLabel({ ...remote, displayName: "apollo" })).toBe("apollo")
})

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

test("used and last projects follow dynamic server scopes, and migration consumes only its scope", () => {
  const [store, setStore] = createStore(
    Schema.decodeUnknownSync(serverSchema())({
      projects: { local: [{ worktree: "/a" }], other: [{ worktree: "/b" }] },
    }),
  )

  const props: { server: ServerConnection.Key; canonicalLocalServer?: ServerConnection.Key } = {
    server: ServerConnection.Key.make("https://remote.example"),
  }

  const projects = createServerProjects({
    store,
    setStore,
    scope: () => ServerScope.fromServerKey(props.server, props.canonicalLocalServer),
  })

  projects.touch("remote-project")
  expect(projects.last()).toBe("remote-project")
  expect(projects.used()).toEqual(["remote-project"])
  expect(projects.legacy()).toBeUndefined()
  props.canonicalLocalServer = props.server
  expect(projects.last()).toBeUndefined()
  expect(projects.legacy()).toEqual(["/a"])
  projects.migrate(["a", "b"])
  projects.touch("a")
  projects.hide(["b"])
  expect(projects.legacy()).toBeUndefined()
  expect(store.projects).toEqual({ other: [{ worktree: "/b" }] })
  expect(store.lastProjectID).toEqual({ local: "a", [props.server]: "remote-project" })
  expect(store.usedProjectIDs).toEqual({ local: ["a"], [props.server]: ["remote-project"] })
})
