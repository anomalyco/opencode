import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { serverState } from "@/runtime/server/persistence"
import { adoptServerDirectory, createServerProjects, ServerConnection } from "@/runtime/server/registry"
import { ServerScope } from "@/runtime/server/scope"

const dir = "/srv/repo"

const other = "/other"

function projectsFor(server: string) {
  const schema = Persistence.withInitial(serverState(), {
    list: [],
    hidden: {},
    projects: {},
    lastProject: {},
    recentlyClosed: {},
  })

  const [store, setStore] = createStore(Schema.decodeUnknownSync(schema)({}))
  const scope = ServerScope.fromServerKey(ServerConnection.Key.make(server))

  return { store, projects: createServerProjects({ store, setStore, scope: () => scope }) }
}

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

function setup() {
  const { projects } = projectsFor("https://a.example")
  const [hydrated, setHydrated] = createSignal(false)
  const [connected, setConnected] = createSignal(false)

  const dispose = createRoot((dispose) => {
    adoptServerDirectory({ hydrated, connected, location: async () => ({ directory: dir }), adopt: projects.adopt })

    return dispose
  })

  return { projects, setHydrated, setConnected, dispose }
}

test("adopts nothing until stored projects have loaded", async () => {
  const { projects, setConnected, dispose } = setup()

  setConnected(true)
  await flush()
  expect(projects.list()).toEqual([])
  dispose()
})

test("adopts the directory once loaded and connected", async () => {
  const { projects, setHydrated, setConnected, dispose } = setup()

  setHydrated(true)
  setConnected(true)
  await flush()
  expect(projects.list()).toEqual([{ worktree: dir, expanded: true }])
  dispose()
})

test("does not adopt the directory again after the user closes it and reconnects", async () => {
  const { projects, setHydrated, setConnected, dispose } = setup()

  setHydrated(true)
  setConnected(true)
  await flush()
  projects.close(dir)
  setConnected(false)
  setConnected(true)
  await flush()
  expect(projects.list()).toEqual([])
  dispose()
})

test("does not adopt when stored projects exist", async () => {
  const { projects, setHydrated, setConnected, dispose } = setup()

  projects.open(other)
  setHydrated(true)
  setConnected(true)
  await flush()
  expect(projects.list()).toEqual([{ worktree: other, expanded: true }])
  dispose()
})
