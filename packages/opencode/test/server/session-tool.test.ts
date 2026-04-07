import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Permission } from "../../src/permission"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

describe("session tool route", () => {
  test(
    "executes read tool and returns file content",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const file = path.join(tmp.path, "hello.txt")
          await fs.writeFile(file, "world")
          const session = await Session.create({})
          spyOn(Permission, "ask").mockResolvedValue(undefined as any)
          const app = Server.Default().app

          const res = await app.request(`/session/${session.id}/tool`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "read",
              args: { filePath: file },
            }),
          })

          expect(res.status).toBe(200)
          const text = await res.text()
          expect(text).toContain("world")

          await Session.remove(session.id)
        },
      })
    },
    { timeout: 15000 },
  )

  test("returns 404 for unknown tool", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "nonexistent_tool_xyz",
            args: {},
          }),
        })

        expect(res.status).toBe(404)
        const text = await res.text()
        expect(text).toContain("Tool not found")

        await Session.remove(session.id)
      },
    })
  })

  test("returns 400 for missing required fields", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(400)

        await Session.remove(session.id)
      },
    })
  })

  test(
    "reports tool execution error in output",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          spyOn(Permission, "ask").mockResolvedValue(undefined as any)
          const app = Server.Default().app

          const res = await app.request(`/session/${session.id}/tool`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "read",
              args: { filePath: "/nonexistent/path/that/does/not/exist.txt" },
            }),
          })

          expect(res.status).toBe(200)
          const text = await res.text()
          expect(text).toContain("Error:")

          await Session.remove(session.id)
        },
      })
    },
    { timeout: 15000 },
  )
})
