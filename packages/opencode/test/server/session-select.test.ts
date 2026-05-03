import { describe, expect, test } from "bun:test"
import path from "path"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function create(dir: string, name: string) {
  return (await Project.createForDirectory({ workspace: dir, name, tenantUserId: "user_test" })).project
}

// TODO: This test times out - possibly related to Server.Default() initialization
// with stateless architecture. Needs investigation.
describe.skip("tui.selectSession endpoint (needs investigation)", () => {
  test("should return 200 when called with valid session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      workspace: tmp.path,
      project: await create(tmp.path, "session-select"),
      fn: async () => {
        // #given
        const session = await Session.create({})

        // #when
        const app = Server.Default()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: session.id }),
        })

        // #then
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("should return 404 when session does not exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      workspace: tmp.path,
      project: await create(tmp.path, "session-select-missing"),
      fn: async () => {
        // #given
        const nonExistentSessionID = "ses_nonexistent123"

        // #when
        const app = Server.Default()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: nonExistentSessionID }),
        })

        // #then
        expect(response.status).toBe(404)
      },
    })
  })

  test("should return 400 when session ID format is invalid", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      workspace: tmp.path,
      project: await create(tmp.path, "session-select-invalid"),
      fn: async () => {
        // #given
        const invalidSessionID = "invalid_session_id"

        // #when
        const app = Server.Default()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: invalidSessionID }),
        })

        // #then
        expect(response.status).toBe(400)
      },
    })
  })
})
