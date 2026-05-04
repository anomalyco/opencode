import { afterEach, describe, expect, test } from "bun:test"
import { HttpRouter } from "effect/unstable/http"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/groups/experimental"
import { WorkspacePaths } from "../../src/server/routes/instance/httpapi/groups/workspace"
import { withTimeout } from "../../src/util/timeout"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const original = {
  OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
  OPENCODE_EXPERIMENTAL_WORKSPACES: Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
}

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
  const server = HttpRouter.toWebHandler(ExperimentalHttpApiServer.routes, { disableLogger: true })
  return {
    request: (input: string, init?: RequestInit) =>
      server.handler(new Request(new URL(input, "http://localhost"), init), ExperimentalHttpApiServer.context),
    dispose: server.dispose,
    [Symbol.asyncDispose]: server.dispose,
  }
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = original.OPENCODE_EXPERIMENTAL_WORKSPACES
  await resetDatabase()
})

describe("worktree endpoint reproduction", () => {
  async function setProjectStartCommand(input: { request: ReturnType<typeof app>["request"]; directory: string; command: string }) {
    const current = await input.request(`/project/current?directory=${encodeURIComponent(input.directory)}`)
    expect(current.status).toBe(200)
    const project = (await current.json()) as { id: string }
    const updated = await input.request(`/project/${project.id}?directory=${encodeURIComponent(input.directory)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commands: { start: input.command } }),
    })
    expect(updated.status).toBe(200)
  }

  test("direct HttpApi worktree create returns without waiting for boot", async () => {
    await using tmp = await tmpdir({ git: true })
    await using server = app()

    const response = await withTimeout(
      server.request(`${ExperimentalPaths.worktree}?directory=${encodeURIComponent(tmp.path)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      5_000,
      "direct worktree create",
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ directory: expect.any(String) })
  })

  test("workspace worktree create does not hang", async () => {
    await using tmp = await tmpdir({ git: true })
    await using server = app()

    const response = await withTimeout(
      server.request(`${WorkspacePaths.list}?directory=${encodeURIComponent(tmp.path)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "worktree", branch: null }),
      }),
      8_000,
      "workspace worktree create",
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ type: "worktree", directory: expect.any(String) })
  })

  test("workspace worktree create returns without waiting for project start command", async () => {
    await using tmp = await tmpdir({ git: true })
    await using server = app()
    await setProjectStartCommand({
      request: server.request,
      directory: tmp.path,
      command: 'bun -e "setTimeout(() => {}, 2000)"',
    })

    const started = Date.now()
    const response = await withTimeout(
      server.request(`${WorkspacePaths.list}?directory=${encodeURIComponent(tmp.path)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "worktree", branch: null }),
      }),
      6_000,
      "workspace worktree create with project start command",
    )

    expect(response.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(1_500)
  })
})
