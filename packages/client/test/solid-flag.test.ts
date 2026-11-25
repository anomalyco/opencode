import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

type Listener = Parameters<CreateDataInput["event"]["listen"]>[0]

/** A data store over a fake server whose flag endpoint answers with `flag(directory)`. */
function setup(flag: (directory: string) => Response) {
  const listeners = new Set<Listener>()
  const requests: string[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const directory = url.searchParams.get("location[directory]") ?? "/project"
      const location = { directory }
      requests.push(`${url.pathname} ${directory}`)
      if (url.pathname === "/api/experimental/flag") return flag(directory)
      if (url.pathname === "/api/location") return Response.json(location)
      if (url.pathname === "/api/project" || url.pathname === "/api/session/active")
        return Response.json(url.pathname === "/api/project" ? [] : {})
      if (url.pathname === "/api/mcp/resource")
        return Response.json({ location, data: { resources: [], templates: [] } })
      if (url.pathname === "/api/vcs") return Response.json({ location, data: {} })
      if (url.pathname === "/api/shell") return Response.json({ location, data: [] })
      return Response.json({ location, data: [] })
    },
  })
  const root = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  const emit = (event: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: event.type, details: event }))
  const count = (directory = "/project") =>
    requests.filter((request) => request === `/api/experimental/flag ${directory}`).length
  return { ...root, emit, count }
}

const until = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !check(); attempt++) await Bun.sleep(5)
  expect(check()).toBe(true)
}

test("syncs a location's flags with the location and reads them", async () => {
  const state = { enabled: true }
  const app = setup((directory) => Response.json({ location: { directory }, data: { full_codemode: state.enabled } }))
  try {
    expect(app.data.location.flag("full_codemode")).toBe(false)
    await app.data.location.sync({ directory: "/project" })
    expect(app.count()).toBe(1)
    expect(app.data.location.flags.list({ directory: "/project" })).toEqual({ full_codemode: true })
    expect(app.data.location.flag("full_codemode", { directory: "/project" })).toBe(true)
    expect(app.data.location.flag("unknown", { directory: "/project" })).toBe(false)
  } finally {
    app.dispose()
  }
})

test("refreshes flags on config.updated, location.shutdown and reconnect", async () => {
  const state = { enabled: false }
  const app = setup((directory) => Response.json({ location: { directory }, data: { full_codemode: state.enabled } }))
  const location = { directory: "/project" }
  try {
    await app.data.location.flags.sync(location)
    expect(app.data.location.flag("full_codemode", location)).toBe(false)

    state.enabled = true
    app.emit({ id: "evt_config", created: 1, type: "config.updated", location, data: {} })
    await until(() => app.data.location.flag("full_codemode", location))

    state.enabled = false
    app.emit({ id: "evt_shutdown", created: 2, type: "location.shutdown", location, data: {} })
    await until(() => !app.data.location.flag("full_codemode", location))

    state.enabled = true
    app.emit({ id: "evt_connected", created: 3, type: "server.connected", data: {} } as OpenCodeEvent)
    await until(() => app.data.location.flag("full_codemode", location))
    expect(app.count()).toBe(4)
  } finally {
    app.dispose()
  }
})

test("an older server without the endpoint reports every flag off without failing sync", async () => {
  const app = setup(() => new Response(null, { status: 404 }))
  try {
    await app.data.location.sync({ directory: "/project" })
    expect(app.data.location.flags.list({ directory: "/project" })).toEqual({})
    expect(app.data.location.flag("full_codemode", { directory: "/project" })).toBe(false)
  } finally {
    app.dispose()
  }
})

test("a missing location still fails the flag sync", async () => {
  const app = setup((directory) =>
    Response.json(
      { _tag: "LocationNotFoundError", location: { directory }, message: `Location not found: ${directory}` },
      { status: 404 },
    ),
  )
  try {
    const error = await app.data.location.flags.sync({ directory: "/gone" }).catch((error: unknown) => error)
    expect(error).toMatchObject({ _tag: "LocationNotFoundError" })
    expect(app.data.location.flags.list({ directory: "/gone" })).toBeUndefined()
  } finally {
    app.dispose()
  }
})

test("keeps each location's flags apart", async () => {
  const app = setup((directory) =>
    Response.json({ location: { directory }, data: { full_codemode: directory === "/on" } }),
  )
  try {
    await Promise.all([
      app.data.location.flags.sync({ directory: "/on" }),
      app.data.location.flags.sync({ directory: "/off" }),
    ])
    expect(app.data.location.flag("full_codemode", { directory: "/on" })).toBe(true)
    expect(app.data.location.flag("full_codemode", { directory: "/off" })).toBe(false)
  } finally {
    app.dispose()
  }
})
