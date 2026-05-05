import { afterEach, describe, expect, test } from "bun:test"
import type { Context } from "hono"
import { Flag } from "@opencode-ai/core/flag/flag"
import { TuiEvent } from "../../src/cli/cmd/tui/event"
import { SessionID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"
import { TuiApi, TuiPaths } from "../../src/server/routes/instance/httpapi/groups/tui"
import { callTui } from "../../src/server/routes/instance/tui"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { OpenApi } from "effect/unstable/httpapi"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { waitGlobalBusEventPromise } from "./global-bus"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app(experimental = true) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = experimental
  return experimental ? Server.Default().app : Server.Legacy().app
}

function nextCommandExecute() {
  return waitGlobalBusEventPromise({
    predicate: (event) => event.payload.type === TuiEvent.CommandExecute.type,
  }).then((event) => event.payload.properties?.command)
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
  await disposeAllInstances()
  await resetDatabase()
})

describe("tui HttpApi bridge", () => {
  test("documents legacy bad request responses", async () => {
    const legacy = await Server.openapiHono()
    const effect = OpenApi.fromApi(TuiApi)
    for (const path of [TuiPaths.appendPrompt, TuiPaths.executeCommand, TuiPaths.publish, TuiPaths.selectSession]) {
      expect(legacy.paths[path].post?.responses?.[400]).toBeDefined()
      expect(effect.paths[path].post?.responses?.[400]).toBeDefined()
    }
  })

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

  test("matches legacy unknown execute command behavior", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const body = JSON.stringify({ command: "unknown_command" })

    const legacyCommand = nextCommandExecute()
    const legacy = await app(false).request(TuiPaths.executeCommand, { method: "POST", headers, body })
    expect(legacy.status).toBe(200)
    expect(await legacy.json()).toBe(true)

    const effectCommand = nextCommandExecute()
    const effect = await app().request(TuiPaths.executeCommand, { method: "POST", headers, body })
    expect(effect.status).toBe(200)
    expect(await effect.json()).toBe(true)

    const legacyPublished = await legacyCommand
    const effectPublished = await effectCommand
    expect(effectPublished).toBe(legacyPublished)
    expect(legacyPublished).toBeUndefined()
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
