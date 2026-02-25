import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("event endpoint contract", () => {
  test("documents directory and session query params", async () => {
    const specs = await Server.openapi()
    const params = specs.paths["/event"]?.get?.parameters ?? []
    const names = params
      .flatMap((item) =>
        "name" in item && typeof item.name === "string" && "in" in item && item.in === "query" ? [item.name] : [],
      )
      .sort()
    expect(names).toEqual(["directory", "session"])
  })

  test("returns SSE when session query param is provided", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const response = await Server.App().request(
          `/event?directory=${encodeURIComponent(projectRoot)}&session=ses_test`,
        )
        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toContain("text/event-stream")
        await response.body?.cancel()
      },
    })
  })

  test("returns SSE without session query param", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const response = await Server.App().request(`/event?directory=${encodeURIComponent(projectRoot)}`)
        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toContain("text/event-stream")
        await response.body?.cancel()
      },
    })
  })
})
