import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { InstancePaths } from "../../src/server/routes/instance/httpapi/groups/instance"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

async function waitDisposed(directory: string) {
  return await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      GlobalBus.off("event", onEvent)
      reject(new Error("timed out waiting for instance disposal"))
    }, 10_000)

    function onEvent(event: { directory?: string; payload: { type?: string } }) {
      if (event.payload.type !== "server.instance.disposed" || event.directory !== directory) return
      clearTimeout(timer)
      GlobalBus.off("event", onEvent)
      resolve()
    }

    GlobalBus.on("event", onEvent)
  })
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("instance HttpApi", () => {
  test("serves catalog read endpoints through Hono bridge", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })

    const [commands, agents, skills, lsp, formatter] = await Promise.all([
      app().request(InstancePaths.command, { headers: { "x-opencode-directory": tmp.path } }),
      app().request(InstancePaths.agent, { headers: { "x-opencode-directory": tmp.path } }),
      app().request(InstancePaths.skill, { headers: { "x-opencode-directory": tmp.path } }),
      app().request(InstancePaths.lsp, { headers: { "x-opencode-directory": tmp.path } }),
      app().request(InstancePaths.formatter, { headers: { "x-opencode-directory": tmp.path } }),
    ])

    expect(commands.status).toBe(200)
    expect(await commands.json()).toContainEqual(expect.objectContaining({ name: "init", source: "command" }))

    expect(agents.status).toBe(200)
    expect(await agents.json()).toContainEqual(expect.objectContaining({ name: "build", mode: "primary" }))

    expect(skills.status).toBe(200)
    expect(await skills.json()).toBeArray()

    expect(lsp.status).toBe(200)
    expect(await lsp.json()).toEqual([])

    expect(formatter.status).toBe(200)
    expect(await formatter.json()).toEqual([])
  })

  test("serves project git init through Hono bridge", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const disposed = waitDisposed(tmp.path)

    const response = await app().request("/project/git/init", {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ vcs: "git", worktree: tmp.path })
    await disposed

    const current = await app().request("/project/current", { headers: { "x-opencode-directory": tmp.path } })
    expect(current.status).toBe(200)
    expect(await current.json()).toMatchObject({ vcs: "git", worktree: tmp.path })
  })

  test("serves project update through Hono bridge", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })

    const current = await app().request("/project/current", { headers: { "x-opencode-directory": tmp.path } })
    expect(current.status).toBe(200)
    const project = (await current.json()) as { id: string }

    const response = await app().request(`/project/${project.id}`, {
      method: "PATCH",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ name: "patched-project", commands: { start: "bun dev" } }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: project.id,
      name: "patched-project",
      commands: { start: "bun dev" },
    })

    const list = await app().request("/project", { headers: { "x-opencode-directory": tmp.path } })
    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(
      expect.objectContaining({ id: project.id, name: "patched-project", commands: { start: "bun dev" } }),
    )
  })

  test("serves instance dispose through Hono bridge", async () => {
    await using tmp = await tmpdir()

    const disposed = new Promise<string | undefined>((resolve) => {
      const onEvent = (event: { directory?: string; payload: { type?: string } }) => {
        if (event.payload.type !== "server.instance.disposed") return
        GlobalBus.off("event", onEvent)
        resolve(event.directory)
      }
      GlobalBus.on("event", onEvent)
    })

    const response = await app().request(InstancePaths.dispose, {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
    expect(await disposed).toBe(tmp.path)
  })
})
