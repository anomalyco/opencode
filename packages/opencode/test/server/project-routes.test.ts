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
      headers: {
        "Content-Type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({ directory: tmp.path }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.worktree).toBe(tmp.path)
    expect(body.id).toBeDefined()
  })

  test("POST /project returns 400 for invalid payload", async () => {
    await using tmp = await tmpdir({ git: true })

    const app = Server.App()
    const response = await app.request("/project", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
  })

  test("DELETE /project/:projectID removes a project", async () => {
    await using tmp = await tmpdir({ git: true })

    const app = Server.App()
    const createResponse = await app.request("/project", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({ directory: tmp.path }),
    })
    expect(createResponse.status).toBe(200)

    const created = await createResponse.json()
    const projectID = created.id as string
    expect(projectID).toBeDefined()

    const deleteResponse = await app.request(`/project/${projectID}`, {
      method: "DELETE",
      headers: { "x-opencode-directory": tmp.path },
    })
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toBe(true)

    const listResponse = await app.request("/project", {
      method: "GET",
      headers: { "x-opencode-directory": tmp.path },
    })
    expect(listResponse.status).toBe(200)
    const projects = (await listResponse.json()) as Array<{ id: string; worktree: string }>
    expect(projects.find((p) => p.id === projectID)).toBeUndefined()
    expect(projects.find((p) => p.worktree === tmp.path)).toBeUndefined()
  })
})
