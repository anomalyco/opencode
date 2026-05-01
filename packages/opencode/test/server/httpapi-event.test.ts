import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/event"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app(experimental = true) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = experimental
  return experimental ? Server.Default().app : Server.Legacy().app
}

async function readFirstChunk(response: Response) {
  if (!response.body) throw new Error("missing response body")
  const reader = response.body.getReader()
  const result = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for event")), 5_000)),
  ])
  await reader.cancel()
  return new TextDecoder().decode(result.value)
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await Instance.disposeAll()
  await resetDatabase()
})

describe("event HttpApi bridge", () => {
  test("serves event stream through experimental Effect route", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
    expect(response.headers.get("x-accel-buffering")).toBe("no")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await readFirstChunk(response)).toContain('data: {"type":"server.connected","properties":{}}\n\n')
  })

  test("matches legacy first event frame", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path }
    const legacy = await app(false).request(EventPaths.event, { headers })
    const effect = await app(true).request(EventPaths.event, { headers })

    expect(await readFirstChunk(effect)).toBe(await readFirstChunk(legacy))
  })
})
