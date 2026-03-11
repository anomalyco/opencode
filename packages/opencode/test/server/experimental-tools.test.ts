import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { ExperimentalRoutes } from "../../src/server/routes/experimental"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function route() {
  return new Hono().route("/experimental", ExperimentalRoutes())
}

async function listTools(query: Record<string, string>) {
  const qs = new URLSearchParams(query)
  const res = await route().request(`/experimental/tool?${qs.toString()}`)
  expect(res.status).toBe(200)
  return (await res.json()) as Array<{ id: string }>
}

async function listToolIDs(query: Record<string, string>) {
  const qs = new URLSearchParams(query)
  const suffix = qs.toString()
  const res = await route().request(`/experimental/tool/ids${suffix ? `?${suffix}` : ""}`)
  expect(res.status).toBe(200)
  return (await res.json()) as string[]
}

describe("ExperimentalRoutes /experimental/tool", () => {
  test("applies agent permissions when listing visible tools", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const buildTools = await listTools({ provider: "openai", model: "qwen-plus", agent: "build" })
        const exploreTools = await listTools({ provider: "openai", model: "qwen-plus", agent: "explore" })

        expect(buildTools.some((tool) => tool.id === "edit")).toBe(true)
        expect(exploreTools.some((tool) => tool.id === "edit")).toBe(false)
      },
    })
  })

  test("applies session permissions when sessionID is provided", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.setPermission({
          sessionID: session.id,
          permission: [{ permission: "bash", pattern: "*", action: "deny" }],
        })

        const withSession = await listTools({
          provider: "openai",
          model: "qwen-plus",
          agent: "build",
          sessionID: session.id,
        })

        expect(withSession.some((tool) => tool.id === "bash")).toBe(false)
      },
    })
  })
})

describe("ExperimentalRoutes /experimental/tool/ids", () => {
  test("applies agent permissions when listing visible tool IDs", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const buildToolIDs = await listToolIDs({ provider: "openai", model: "qwen-plus", agent: "build" })
        const exploreToolIDs = await listToolIDs({ provider: "openai", model: "qwen-plus", agent: "explore" })

        expect(buildToolIDs.includes("edit")).toBe(true)
        expect(exploreToolIDs.includes("edit")).toBe(false)
      },
    })
  })

  test("applies session permissions to tool IDs when sessionID is provided", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.setPermission({
          sessionID: session.id,
          permission: [{ permission: "bash", pattern: "*", action: "deny" }],
        })

        const withSession = await listToolIDs({
          provider: "openai",
          model: "qwen-plus",
          agent: "build",
          sessionID: session.id,
        })

        expect(withSession.includes("bash")).toBe(false)
      },
    })
  })
})
