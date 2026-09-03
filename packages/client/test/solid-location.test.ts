import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput, type Data } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

const held = { directory: "/held" }
const released = { directory: "/released" }
const categories = [
  "model",
  "provider",
  "agent",
  "command",
  "integration",
  "skill",
  "reference",
  "mcp.server",
  "mcp.resource",
] as const

test("a release keeps the identity of a live session location across session.moved", async () => {
  const setup = fixture()
  const a = { directory: "/move-a" }
  const b = { directory: "/move-b" }
  try {
    setup.data.session.remember({
      id: "ses_move",
      projectID: "project",
      location: { ...a },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    })
    const original = setup.data.session.get("ses_move")!.location
    const release = setup.data.location.retain(original)
    await Promise.all([a, b].flatMap((ref) => categories.map((category) => catalog(setup.data, category).sync(ref))))
    setup.emit({
      id: "evt_move",
      created: 1,
      type: "session.moved",
      durable: { aggregateID: "ses_move", seq: 1, version: 1 },
      data: { sessionID: "ses_move", location: b, projectID: "project" },
    })
    release()
    await setup.settle()
    for (const category of categories) expect(catalog(setup.data, category).list(a)).toBeUndefined()
    setup.requests.length = 0
    await Promise.all(categories.map((category) => catalog(setup.data, category).sync(b)))
    const bRequests = [...setup.requests]
    setup.requests.length = 0
    await Promise.all(categories.map((category) => catalog(setup.data, category).sync(a)))
    if (process.env.OPENCODE_LOCATION_EVIDENCE)
      console.log(
        "LOCATION_MOVE_CLIENT",
        JSON.stringify({
          sameProxy: original === setup.data.session.get("ses_move")!.location,
          originalNow: original.directory,
          bRequests,
          aRequests: setup.requests,
          a: categories.map((category) => [category, catalog(setup.data, category).list(a) ?? null]),
          b: categories.map((category) => [category, catalog(setup.data, category).list(b) ?? null]),
        }),
      )
    expect(bRequests).toEqual([])
    expect(setup.requests).toHaveLength(categories.length)
    for (const category of categories) {
      expect(catalog(setup.data, category).list(a)).toHaveLength(1)
      expect(catalog(setup.data, category).list(b)).toHaveLength(1)
    }
    setup.requests.length = 0
    await Promise.all(categories.map((category) => catalog(setup.data, category).sync(a)))
    expect(setup.requests).toEqual([])
  } finally {
    setup.dispose()
  }
})

test.each(categories)("last release rejects a late first %s response", async (category) => {
  const requested = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  const setup = fixture(async () => {
    requested.resolve()
    await gate.promise
  })
  const resource = catalog(setup.data, category)
  try {
    const release = setup.data.location.retain(released)
    const initial = resource.sync(released)
    await requested.promise
    release()
    await Promise.resolve()
    gate.resolve()
    await initial
    expect(resource.list(released)).toBeUndefined()
    await resource.sync(released)
    await resource.sync(released)
    expect(setup.requests).toHaveLength(2)
    expect(resource.list(released)).toHaveLength(1)
  } finally {
    gate.resolve()
    setup.dispose()
  }
})

test.each(categories)(
  "a queued %s sync keeps its invocation generation across close/reopen/close",
  async (category) => {
    const requested = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const setup = fixture(async () => {
      requested.resolve()
      await gate.promise
    })
    const resource = catalog(setup.data, category)
    try {
      const release = setup.data.location.retain(released)
      const initial = resource.sync(released)
      await requested.promise
      release()
      await Promise.resolve()
      const close = setup.data.location.retain(released)
      const queued = resource.sync(released)
      close()
      await Promise.resolve()
      gate.resolve()
      await Promise.all([initial, queued])
      expect(resource.list(released)).toBeUndefined()
      expect(setup.requests).toHaveLength(1)
      const reopen = setup.data.location.retain(released)
      await resource.sync(released)
      await resource.sync(released)
      expect(setup.requests).toHaveLength(2)
      expect(resource.list(released)).toHaveLength(1)
      reopen()
      await Promise.resolve()
      expect(resource.list(released)).toBeUndefined()
    } finally {
      gate.resolve()
      setup.dispose()
    }
  },
)

test("released aggregate sync does not start catalogs after delayed location info", async () => {
  const requested = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  const setup = fixture(async (url) => {
    if (url.pathname !== "/api/location") return
    requested.resolve()
    await gate.promise
  })
  try {
    const release = setup.data.location.retain(released)
    const initial = setup.data.location.sync(released)
    await requested.promise
    release()
    await Promise.resolve()
    gate.resolve()
    await initial
    for (const category of categories) expect(catalog(setup.data, category).list(released)).toBeUndefined()
    expect(setup.requests).toEqual(["/api/location /released"])
    await setup.data.location.sync(released)
    for (const category of categories) expect(catalog(setup.data, category).list(released)).toHaveLength(1)
  } finally {
    gate.resolve()
    setup.dispose()
  }
})

test.each([false, true])("release-window events do not revive pending catalogs (reacquire: %s)", async (reacquire) => {
  const gate = Promise.withResolvers<void>()
  const setup = fixture((url) => (url.pathname === "/api/location" ? Promise.resolve() : gate.promise))
  try {
    await setup.data.location.syncInfo(released)
    const release = setup.data.location.retain(released)
    const initial = categories.map((category) => catalog(setup.data, category).sync(released))
    release()
    await Promise.resolve()
    // Merely retaining again does not make an old pending request current.
    const close = reacquire ? setup.data.location.retain(released) : () => {}
    setup.emit({ id: "evt_credentials", created: 1, type: "credential.updated", data: {} })
    setup.emit({
      id: "evt_switch",
      created: 1,
      type: "credential.switched",
      data: { integrationID: "integration", credentialID: null },
    })
    for (const type of [
      "catalog.updated",
      "agent.updated",
      "command.updated",
      "skill.updated",
      "integration.updated",
      "mcp.status.changed",
      "mcp.resources.changed",
    ] as const) {
      setup.emit({ id: `evt_${type}`, created: 1, type, location: released, data: { server: "fixture" } })
    }
    gate.resolve()
    await Promise.all(initial)
    await setup.settle()
    expect(setup.requests).toHaveLength(categories.length + 1)
    for (const category of categories) expect(catalog(setup.data, category).list(released)).toBeUndefined()
    // An explicit load after release is supported even without a hold (including TUI callers).
    await Promise.all(categories.map((category) => catalog(setup.data, category).sync(released)))
    const reads = setup.requests.length
    setup.emit({ id: "evt_current", created: 2, type: "catalog.updated", location: released, data: {} })
    await setup.settle()
    expect(setup.requests).toHaveLength(reads + 2)
    for (const category of categories) expect(catalog(setup.data, category).list(released)).toHaveLength(1)
    close()
  } finally {
    gate.resolve()
    setup.dispose()
  }
})

test("default-location late loads survive last release", async () => {
  const gate = Promise.withResolvers<void>()
  const setup = fixture((url) => (url.pathname === "/api/location" ? Promise.resolve() : gate.promise))
  try {
    await setup.data.location.syncInfo()
    const release = setup.data.location.retain(setup.data.location.default())
    const initial = categories.map((category) => catalog(setup.data, category).sync())
    release()
    await Promise.resolve()
    gate.resolve()
    await Promise.all(initial)
    for (const category of categories) expect(catalog(setup.data, category).list()).toHaveLength(1)
    const reads = setup.requests.length
    await Promise.all(categories.map((category) => catalog(setup.data, category).sync()))
    expect(setup.requests).toHaveLength(reads)
  } finally {
    gate.resolve()
    setup.dispose()
  }
})

test("a current explicit load queued after release can still be refreshed by events", async () => {
  const gate = Promise.withResolvers<void>()
  const setup = fixture((url) => (url.pathname === "/api/location" ? Promise.resolve() : gate.promise))
  try {
    await setup.data.location.syncInfo(released)
    const release = setup.data.location.retain(released)
    const initial = categories.map((category) => catalog(setup.data, category).sync(released))
    release()
    await Promise.resolve()
    const close = setup.data.location.retain(released)
    const current = categories.map((category) => catalog(setup.data, category).sync(released))
    setup.emit({ id: "evt_reopened", created: 1, type: "catalog.updated", location: released, data: {} })
    gate.resolve()
    await Promise.all([...initial, ...current])
    await setup.settle()
    expect(setup.requests).toHaveLength(1 + categories.length * 2 + 2)
    const reads = setup.requests.length
    await Promise.all(categories.map((category) => catalog(setup.data, category).sync(released)))
    expect(setup.requests).toHaveLength(reads)
    for (const category of categories) expect(catalog(setup.data, category).list(released)).toHaveLength(1)
    close()
  } finally {
    gate.resolve()
    setup.dispose()
  }
})

function catalog(data: Data, category: (typeof categories)[number]) {
  if (category === "mcp.server") return data.location.mcp.server
  if (category === "mcp.resource") return data.location.mcp.resource
  return data.location[category]
}

test("releasing the last hold drops catalogs, keeps light metadata, and reloads on the next sync", async () => {
  const setup = fixture()
  try {
    const release = setup.data.location.retain(released)
    const again = setup.data.location.retain(released)
    await Promise.all([setup.data.location.sync(released), setup.data.location.sync(held)])
    setup.requests.length = 0

    release()
    await setup.settle()
    expect(setup.data.location.model.list(released)).toHaveLength(1)
    again()
    again()
    expect(setup.data.location.model.list(released)).toHaveLength(1)
    await setup.settle()
    expect(setup.data.location.model.list(released)).toBeUndefined()
    expect(setup.data.location.provider.list(released)).toBeUndefined()
    expect(setup.data.location.agent.list(released)).toBeUndefined()
    expect(setup.data.location.command.list(released)).toBeUndefined()
    expect(setup.data.location.skill.list(released)).toBeUndefined()
    expect(setup.data.location.integration.list(released)).toBeUndefined()
    expect(setup.data.location.mcp.server.list(released)).toBeUndefined()
    expect(setup.data.location.mcp.resource.list(released)).toBeUndefined()
    expect(setup.data.location.reference.list(released)).toBeUndefined()
    expect(setup.data.location.info(released)?.directory).toBe("/released")
    expect(setup.data.location.vcs.info(released)?.branch.current).toBe("main")
    expect(setup.data.location.model.list(held)).toHaveLength(1)
    expect(setup.requests).toEqual([])

    await setup.data.location.model.sync(released)
    expect(setup.requests).toEqual(["/api/model /released"])
    expect(setup.data.location.model.list(released)).toHaveLength(1)
  } finally {
    setup.dispose()
  }
})

test("a hold re-acquired within the same task keeps the catalogs", async () => {
  const setup = fixture()
  try {
    const release = setup.data.location.retain(released)
    await setup.data.location.sync(released)
    setup.requests.length = 0
    release()
    const next = setup.data.location.retain(released)
    await setup.settle()
    expect(setup.data.location.model.list(released)).toHaveLength(1)
    await setup.data.location.model.sync(released)
    expect(setup.requests).toEqual([])
    next()
    await setup.settle()
    expect(setup.data.location.model.list(released)).toBeUndefined()
  } finally {
    setup.dispose()
  }
})

test("the default location stays resident after its holds release", async () => {
  const setup = fixture()
  try {
    await setup.data.location.sync()
    const release = setup.data.location.retain(setup.data.location.default())
    release()
    await setup.settle()
    expect(setup.data.location.model.list()).toHaveLength(1)
    expect(setup.data.location.model.list({ directory: "/project" })).toHaveLength(1)
  } finally {
    setup.dispose()
  }
})

test("event-driven refreshes reload only catalogs that are loaded or loading", async () => {
  const setup = fixture()
  try {
    const release = setup.data.location.retain(released)
    await Promise.all([setup.data.location.sync(released), setup.data.location.sync(held)])
    release()
    await setup.settle()
    setup.requests.length = 0

    setup.emit({ id: "evt_credential", created: 1, type: "credential.updated", data: {} })
    setup.emit({
      id: "evt_switched",
      created: 2,
      type: "credential.switched",
      data: { integrationID: "integration", credentialID: "credential" },
    })
    await setup.settle()
    expect(setup.requests.toSorted()).toEqual(["/api/integration /held", "/api/model /held", "/api/provider /held"])
    setup.requests.length = 0

    for (const type of ["catalog.updated", "agent.updated", "command.updated", "skill.updated"] as const) {
      setup.emit({ id: `evt_${type}_released`, created: 3, type, location: released, data: {} })
      setup.emit({ id: `evt_${type}_unknown`, created: 3, type, location: { directory: "/never" }, data: {} })
      setup.emit({ id: `evt_${type}_held`, created: 3, type, location: held, data: {} })
    }
    await setup.settle()
    expect(setup.requests.toSorted()).toEqual([
      "/api/agent /held",
      "/api/command /held",
      "/api/model /held",
      "/api/provider /held",
      "/api/skill /held",
    ])
    expect(setup.data.location.model.list(released)).toBeUndefined()
  } finally {
    setup.dispose()
  }
})

test("an event during the first load still refreshes after that load settles", async () => {
  const gate = Promise.withResolvers<void>()
  const setup = fixture(async (url) => {
    if (url.pathname === "/api/model" && url.searchParams.get("location[directory]") === "/held") await gate.promise
  })
  try {
    const initial = setup.data.location.model.sync(held)
    setup.emit({ id: "evt_catalog", created: 1, type: "catalog.updated", location: held, data: {} })
    gate.resolve()
    await initial
    await setup.settle()
    expect(setup.requests.filter((request) => request === "/api/model /held")).toHaveLength(2)
  } finally {
    gate.resolve()
    setup.dispose()
  }
})

function fixture(before?: (url: URL) => Promise<void>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const requests: string[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const directory = url.searchParams.get("location[directory]") || "/project"
      requests.push(`${url.pathname} ${directory}`)
      await before?.(url)
      const location = { directory, project: { id: "project", directory, canonical: directory } }
      if (url.pathname === "/api/location") return Response.json(location)
      if (url.pathname === "/api/vcs") return Response.json({ location, data: { branch: { current: "main" } } })
      if (url.pathname === "/api/mcp/resource")
        return Response.json({ location, data: { resources: [{ server: "mcp", uri: "file://x" }], templates: [] } })
      if (url.pathname === "/api/shell") return Response.json({ location, data: [] })
      if (url.pathname === "/api/form/request") return Response.json({ location, data: [] })
      return Response.json({ location, data: [{ id: `${url.pathname}:${directory}`, providerID: "opencode" }] })
    },
  })
  return createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
      connection: { status: () => "connected" },
    })
    return {
      data,
      requests,
      dispose,
      emit: (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details })),
      // Event handlers issue their reads synchronously; a macrotask lets those reads settle.
      settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    }
  })
}
