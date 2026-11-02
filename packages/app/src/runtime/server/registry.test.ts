import { expect, test } from "bun:test"
import {
  canRemoveServer,
  createServerProjects,
  resolveServerList,
  resolveVisibleServers,
  ServerConnection,
  serverLabel,
} from "./registry"
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

test("treats WSL and mismatched-port loopback servers as remote connections", () => {
  const windowsSidecar = "http://127.0.0.1:28894"

  expect(
    ServerConnection.local(
      {
        type: "plugin",
        key: "wsl:Debian",
        plugin: "wsl",
        state: "ready",
        connecting: false,
        authenticationRequired: false,
        managed: false,
        http: { url: "http://127.0.0.1:4097" },
      },
      windowsSidecar,
    ),
  ).toBe(false)
  expect(
    ServerConnection.local({ type: "sidecar", variant: "base", http: { url: windowsSidecar } }),
  ).toBe(true)
  expect(ServerConnection.local({ type: "http", http: { url: "http://localhost:28894" } }, windowsSidecar)).toBe(true)
  expect(ServerConnection.local({ type: "http", http: { url: "http://[::1]:28894" } }, windowsSidecar)).toBe(true)
  expect(ServerConnection.local({ type: "http", http: { url: "http://localhost:4096" } }, windowsSidecar)).toBe(false)
  expect(ServerConnection.local({ type: "http", http: { url: "http://127.0.0.1:4096" } }, windowsSidecar)).toBe(false)
  expect(ServerConnection.local({ type: "http", http: { url: "http://localhost:49374" } }, windowsSidecar)).toBe(false)
  expect(ServerConnection.local({ type: "http", http: { url: "http://localhost:4096" } })).toBe(false)
  expect(ServerConnection.local({ type: "http", http: { url: "https://server.example.test" } }, windowsSidecar)).toBe(
    false,
  )
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

test("hidden servers are left out, but never every server: the built-in one, otherwise the first, stays shown", () => {
  const sidecar: ServerConnection.Sidecar = { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } }
  const remote: ServerConnection.Http = { type: "http", http: { url: "https://apollo.example.test" } }
  const other: ServerConnection.Http = { type: "http", http: { url: "https://zeus.example.test" } }

  const hide = (...servers: ServerConnection.Any[]) =>
    Object.fromEntries(servers.map((server) => [ServerConnection.key(server), true]))

  expect(resolveVisibleServers({ servers: [sidecar, remote], hidden: {} })).toEqual([sidecar, remote])
  expect(resolveVisibleServers({ servers: [sidecar, remote], hidden: hide(sidecar) })).toEqual([remote])
  expect(resolveVisibleServers({ servers: [remote, sidecar], hidden: hide(remote, sidecar) })).toEqual([sidecar])
  expect(resolveVisibleServers({ servers: [remote, other], hidden: hide(remote, other) })).toEqual([remote])
  expect(resolveVisibleServers({ servers: [], hidden: hide(remote) })).toEqual([])
})

/** The server props a project store follows, which the test changes. */
type ProjectScopeProps = { server: ServerConnection.Key; canonicalLocalServer?: ServerConnection.Key }

test("used and last projects follow dynamic server scopes, and migration consumes only its scope", () => {
  const [store, setStore] = createStore(
    Schema.decodeUnknownSync(serverSchema())({
      projects: { local: [{ worktree: "/a" }], other: [{ worktree: "/b" }] },
    }),
  )

  const props: ProjectScopeProps = { server: ServerConnection.Key.make("https://remote.example") }

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
