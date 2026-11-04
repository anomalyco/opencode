import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { ServerState } from "@/runtime/server/persistence"
import { adoptServerDirectory, createServerProjects, ServerConnection } from "@/runtime/server/registry"
import { ServerScope } from "@/runtime/server/scope"

const dir = "/srv/repo"

const other = "/other"

// What the project list is stored under for this server: `fromServerKey` maps a non-local key to itself.
const scope = "https://a.example"

function projectsFor(server: string) {
  const schema = Persistence.withInitial(ServerState, {
    list: [],
    hidden: {},
    lastProjectID: {},
    usedProjectIDs: {},
    hostnames: {},
    projects: {},
  })

  const [store, setStore] = createStore(Schema.decodeUnknownSync(schema)({}))
  const scope = ServerScope.fromServerKey(ServerConnection.Key.make(server))

  return { store, setStore, projects: createServerProjects({ store, setStore, scope: () => scope }) }
}

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

function setup() {
  const { store, setStore, projects } = projectsFor(scope)
  const [hydrated, setHydrated] = createSignal(false)
  const [connected, setConnected] = createSignal(false)

  const dispose = createRoot((dispose) => {
    adoptServerDirectory({ hydrated, connected, location: async () => ({ directory: dir }), adopt: projects.adopt })

    return dispose
  })

  return { store, setStore, projects, setHydrated, setConnected, dispose }
}

test("adopts nothing until stored projects have loaded", async () => {
  const { store, setConnected, dispose } = setup()

  setConnected(true)
  await flush()
  expect(store.projects[scope]).toBeUndefined()
  dispose()
})

test("adopts the directory once loaded and connected", async () => {
  const { store, setHydrated, setConnected, dispose } = setup()

  setHydrated(true)
  setConnected(true)
  await flush()
  expect(store.projects[scope]).toEqual([{ worktree: dir }])
  dispose()
})

test("does not adopt when stored projects exist", async () => {
  const { store, setStore, setHydrated, setConnected, dispose } = setup()

  // Hydration lands before the server connects, the order the app sees it in.
  setHydrated(true)
  await flush()
  setStore("projects", scope, [{ worktree: other, expanded: true }])
  setConnected(true)
  await flush()
  expect(store.projects[scope]).toEqual([{ worktree: other, expanded: true }])
  dispose()
})
