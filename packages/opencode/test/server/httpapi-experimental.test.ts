import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Flag } from "@opencode-ai/core/flag/flag"
import { GlobalBus } from "@/bus/global"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/experimental"
import { Database } from "../../src/storage"
import { Log } from "../../src/util"
import { Worktree } from "../../src/worktree"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket
const testWorktreeMutations = process.platform === "win32" ? test.skip : test

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return InstanceRoutes(websocket)
}

async function waitReady(directory: string) {
  return await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      GlobalBus.off("event", onEvent)
      reject(new Error("timed out waiting for worktree.ready"))
    }, 10_000)

    function onEvent(event: { directory?: string; payload: { type?: string } }) {
      if (event.payload.type !== Worktree.Event.Ready.type || event.directory !== directory) return
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

describe("experimental HttpApi", () => {
  test("serves read-only experimental endpoints through Hono bridge", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: false,
        lsp: false,
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const headers = { "x-opencode-directory": tmp.path }
    const [consoleState, consoleOrgs, toolList, toolIDs, worktrees, resources] = await Promise.all([
      app().request(ExperimentalPaths.console, { headers }),
      app().request(ExperimentalPaths.consoleOrgs, { headers }),
      app().request(`${ExperimentalPaths.tool}?provider=opencode&model=gpt-5`, { headers }),
      app().request(ExperimentalPaths.toolIDs, { headers }),
      app().request(ExperimentalPaths.worktree, { headers }),
      app().request(ExperimentalPaths.resource, { headers }),
    ])

    expect(consoleState.status).toBe(200)
    expect(await consoleState.json()).toEqual({
      consoleManagedProviders: [],
      switchableOrgCount: 0,
    })

    expect(consoleOrgs.status).toBe(200)
    expect(await consoleOrgs.json()).toEqual({ orgs: [] })

    expect(toolList.status).toBe(200)
    expect(await toolList.json()).toContainEqual(
      expect.objectContaining({
        id: "bash",
        description: expect.any(String),
        parameters: expect.any(Object),
      }),
    )

    expect(toolIDs.status).toBe(200)
    expect(await toolIDs.json()).toContain("bash")

    expect(worktrees.status).toBe(200)
    expect(await worktrees.json()).toEqual([])

    expect(resources.status).toBe(200)
    expect(await resources.json()).toEqual({})
  })

  test("serves Console org switch through Hono bridge", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    Database.Client()
      .$client.prepare(
        "INSERT INTO account (id, email, url, access_token, refresh_token, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "account-test",
        "test@example.com",
        "https://console.example.com",
        "access",
        "refresh",
        Date.now(),
        Date.now(),
      )

    const switched = await app().request(ExperimentalPaths.consoleSwitch, {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ accountID: "account-test", orgID: "org-test" }),
    })

    expect(switched.status).toBe(200)
    expect(await switched.json()).toBe(true)
  })

  testWorktreeMutations("serves worktree mutations through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const created = await app().request(ExperimentalPaths.worktree, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "api-test" }),
    })

    expect(created.status).toBe(200)
    const info = (await created.json()) as Worktree.Info
    expect(info).toMatchObject({ name: "api-test", branch: "opencode/api-test" })
    await waitReady(info.directory)

    const listed = await app().request(ExperimentalPaths.worktree, { headers })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toContain(info.directory)

    if (process.platform !== "win32") {
      const reset = await app().request(ExperimentalPaths.worktreeReset, {
        method: "POST",
        headers,
        body: JSON.stringify({ directory: info.directory }),
      })

      expect(reset.status).toBe(200)
      expect(await reset.json()).toBe(true)
    }

    const removed = await app().request(ExperimentalPaths.worktree, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ directory: info.directory }),
    })

    expect(removed.status).toBe(200)
    expect(await removed.json()).toBe(true)

    const afterRemove = await app().request(ExperimentalPaths.worktree, { headers })
    expect(afterRemove.status).toBe(200)
    expect(await afterRemove.json()).toEqual([])
  })
})
