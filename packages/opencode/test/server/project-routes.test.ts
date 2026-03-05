import { describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("project routes", () => {
  test("POST /project registers a project from directory", async () => {
    await using tmp = await tmpdir({ git: true })

    const app = Server.App()
    const response = await app.request("/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: tmp.path }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.worktree).toBe(tmp.path)
    expect(body.id).toBeDefined()
  })

  test("POST /project returns 400 for invalid payload", async () => {
    const app = Server.App()
    const response = await app.request("/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
  })
})
