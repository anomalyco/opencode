import { afterEach, describe, expect, test } from "bun:test"
import type { Context } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import { Flag } from "@opencode-ai/core/flag/flag"
import { SessionID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { TuiPaths } from "../../src/server/routes/instance/httpapi/tui"
import { callTui } from "../../src/server/routes/instance/tui"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return InstanceRoutes(websocket)
}

async function expectTrue(path: string, headers: Record<string, string>, body?: unknown) {
  const response = await app().request(path, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toBe(true)
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("tui HttpApi bridge", () => {
  test("serves TUI command and event routes through experimental Effect routes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }

    await expectTrue(TuiPaths.appendPrompt, headers, { text: "hello" })
    await expectTrue(TuiPaths.openHelp, headers)
    await expectTrue(TuiPaths.openSessions, headers)
    await expectTrue(TuiPaths.openThemes, headers)
    await expectTrue(TuiPaths.openModels, headers)
    await expectTrue(TuiPaths.submitPrompt, headers)
    await expectTrue(TuiPaths.clearPrompt, headers)
    await expectTrue(TuiPaths.executeCommand, headers, { command: "agent_cycle" })
    await expectTrue(TuiPaths.showToast, headers, { message: "Saved", variant: "success" })
    await expectTrue(TuiPaths.publish, headers, {
      type: "tui.prompt.append",
      properties: { text: "from publish" },
    })

    const missing = await app().request(TuiPaths.selectSession, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ sessionID: SessionID.descending() }),
    })
    expect(missing.status).toBe(404)
  })

  test("serves TUI control queue through experimental Effect routes", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const pending = callTui({ req: { json: async () => ({ value: 1 }), path: "/demo" } } as unknown as Context)
    const headers = { "x-opencode-directory": tmp.path }

    const next = await app().request(TuiPaths.controlNext, { headers })
    expect(next.status).toBe(200)
    expect(await next.json()).toEqual({ path: "/demo", body: { value: 1 } })

    await expectTrue(TuiPaths.controlResponse, headers, { ok: true })
    expect(await pending).toEqual({ ok: true })
  })
})
