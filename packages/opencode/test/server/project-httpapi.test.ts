import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("experimental project httpapi", () => {
  test("lists projects, returns current project, and serves docs", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.Default().app
    const headers = {
      "content-type": "application/json",
      "x-opencode-directory": tmp.path,
    }

    const list = await app.request("/experimental/httpapi/project", { headers })
    expect(list.status).toBe(200)
    const items = await list.json()
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].worktree).toBeDefined()

    const current = await app.request("/experimental/httpapi/project/current", { headers })
    expect(current.status).toBe(200)
    const project = await current.json()
    expect(project.worktree).toBe(tmp.path)

    const doc = await app.request("/experimental/httpapi/project/doc", { headers })
    expect(doc.status).toBe(200)
    const spec = await doc.json()
    expect(spec.paths["/experimental/httpapi/project"]?.get?.operationId).toBe("project.list")
    expect(spec.paths["/experimental/httpapi/project/current"]?.get?.operationId).toBe("project.current")
  })
})
