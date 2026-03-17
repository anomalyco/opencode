import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

describe("session.workspaceDirectory endpoint", () => {
  test("adds external directory for a session", async () => {
    await using outside = await tmpdir({})
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.createApp({})
        const response = await app.request(
          `/session/${session.id}/workspace/directory?directory=${encodeURIComponent(project.path)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: outside.path }),
          },
        )

        expect(response.status).toBe(200)

        const body = (await response.json()) as {
          added: boolean
          directory: string
          glob: string
          session: { id: string }
        }
        expect(body.added).toBe(true)
        expect(body.directory).toBe(outside.path)
        expect(body.glob).toBe(path.join(outside.path, "*"))
        expect(body.session.id).toBe(session.id)

        const second = await app.request(
          `/session/${session.id}/workspace/directory?directory=${encodeURIComponent(project.path)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: outside.path }),
          },
        )

        expect(second.status).toBe(200)
        const duplicate = (await second.json()) as { added: boolean }
        expect(duplicate.added).toBe(false)
      },
    })
  })

  test("validates request body", async () => {
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.createApp({})
        const response = await app.request(
          `/session/${session.id}/workspace/directory?directory=${encodeURIComponent(project.path)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        )

        expect(response.status).toBe(400)
      },
    })
  })

  test("returns not found for missing directory", async () => {
    await using project = await tmpdir({ git: true })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.createApp({})
        const response = await app.request(
          `/session/${session.id}/workspace/directory?directory=${encodeURIComponent(project.path)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: `${project.path}/missing` }),
          },
        )

        expect(response.status).toBe(404)
      },
    })
  })
})
