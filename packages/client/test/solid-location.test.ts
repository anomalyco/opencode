import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { OpenCode } from "../src/promise"
import { createData, LocationSyncError } from "../src/solid"

const location = { directory: "/project", project: { id: "project", directory: "/project" } }

function setup(failure: (path: string) => Response | undefined) {
  const requests: string[] = []
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const path = new URL(request.url).pathname
      requests.push(path)
      const response = failure(path)
      if (response) return response
      if (path === "/api/location") return Response.json(location)
      const data = path === "/api/mcp/resource" ? { resources: [], templates: [] } : []
      return Response.json({ location, data })
    },
  })
  return createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: location.directory,
      event: { on: () => () => {}, listen: () => () => {} },
      connection: { status: () => "connected" },
    }),
    requests,
    dispose,
  }))
}

test("location lookup failures retain their stage, location, and cause", async () => {
  const app = setup(() => Response.json({ message: "configuration failed" }, { status: 500 }))
  try {
    await expect(app.data.location.syncInfo()).rejects.toMatchObject({
      name: "LocationSyncError",
      resource: "info",
      location: { directory: location.directory },
      reason: "location",
      cause: { reason: "UnexpectedStatus", cause: { status: 500 } },
    })
    expect(app.requests).toEqual(["/api/location"])
    expect(app.data.location.info()).toBeUndefined()
  } finally {
    app.dispose()
  }
})

test.each([
  ["vcs", "/api/vcs"],
  ["agent", "/api/agent"],
  ["command", "/api/command"],
  ["integration", "/api/integration"],
  ["mcp.server", "/api/mcp"],
  ["mcp.resource", "/api/mcp/resource"],
  ["model", "/api/model"],
  ["provider", "/api/provider"],
  ["reference", "/api/reference"],
  ["skill", "/api/skill"],
  ["shell", "/api/shell"],
  ["form", "/api/form/request"],
])("location sync identifies failed %s resources without discarding the location", async (resource, path) => {
  let fail = true
  const app = setup((current) =>
    fail && current === path ? Response.json({ message: "server restarting" }, { status: 503 }) : undefined,
  )
  try {
    await expect(app.data.location.sync()).rejects.toMatchObject({
      name: "LocationSyncError",
      resource,
      reason: "resource",
      location: { directory: location.directory },
      cause: expect.anything(),
    })
    expect(app.data.location.info()).toEqual(location)
    fail = false
    await app.data.location.sync()
    expect(app.requests.filter((current) => current === path)).toHaveLength(2)
    expect(app.requests.filter((current) => current === "/api/location")).toHaveLength(1)
  } finally {
    app.dispose()
  }
})

test("location sync preserves transport errors without claiming the directory is missing", async () => {
  const app = setup(() => {
    throw new Error("connection refused")
  })
  try {
    await expect(app.data.location.sync()).rejects.toMatchObject({
      name: "LocationSyncError",
      resource: "info",
      reason: "transport",
      cause: { reason: "Transport" },
    })
  } finally {
    app.dispose()
  }
})

test("sync errors preserve the original cause by identity", () => {
  const cause = new Error("model catalog failed")
  const error = new LocationSyncError(location, "model", cause)
  expect(error.cause).toBe(cause)
  expect(error.message).toContain("model")
  expect(error.message).toContain(location.directory)
})

test.each(["not_found", "not_directory"])("only explicit %s responses mark a location missing", async (reason) => {
  const app = setup(() =>
    Response.json(
      {
        _tag: "LocationDirectoryError",
        directory: location.directory,
        reason,
        message: "Directory unavailable",
      },
      { status: 404 },
    ),
  )
  try {
    await expect(app.data.location.sync()).rejects.toMatchObject({
      reason: "missing",
      resource: "info",
      cause: { _tag: "LocationDirectoryError", reason },
    })
  } finally {
    app.dispose()
  }
})

test("unrelated 404s and resource errors do not imply a missing location", () => {
  expect(new LocationSyncError(location, "info", { _tag: "ProjectNotFoundError" }).reason).toBe("location")
  const cause = { _tag: "LocationDirectoryError", directory: location.directory, reason: "not_found" }
  expect(new LocationSyncError(location, "model", cause).reason).toBe("resource")
  expect(new LocationSyncError({ directory: "/other" }, "info", cause).reason).toBe("location")
})
