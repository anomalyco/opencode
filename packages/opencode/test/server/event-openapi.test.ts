import { describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"

Log.init({ print: false })

describe("event endpoint contract", () => {
  test("documents directory and session query params", async () => {
    const specs = await Server.openapi()
    const params = specs.paths["/event"]?.get?.parameters ?? []
    const names = params.flatMap((item) => ("name" in item && typeof item.name === "string" ? [item.name] : [])).sort()
    expect(names).toEqual(["directory", "session"])
  })

  test("returns SSE when session query param is provided", async () => {
    const response = await Server.App().request("/event?session=ses_test")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    await response.body?.cancel()
  })

  test("returns SSE without session query param", async () => {
    const response = await Server.App().request("/event")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    await response.body?.cancel()
  })
})
