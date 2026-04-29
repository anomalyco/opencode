import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function client(directory?: string) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  const handler = ExperimentalHttpApiServer.webHandler().handler
  const fetch = Object.assign(
    (request: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(request, init), ExperimentalHttpApiServer.context),
    { preconnect: globalThis.fetch.preconnect },
  ) satisfies typeof globalThis.fetch
  return createOpencodeClient({
    baseUrl: "http://localhost",
    directory,
    fetch,
  })
}

async function expectStatus(result: Promise<{ response: Response }>, status: number) {
  expect((await result).response.status).toBe(status)
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await resetDatabase()
})

describe("HttpApi SDK", () => {
  test("uses the generated SDK for global and control routes", async () => {
    const sdk = client()
    const health = await sdk.global.health()

    expect(health.response.status).toBe(200)
    expect(health.data).toMatchObject({ healthy: true })

    const events = await sdk.global.event({ signal: AbortSignal.timeout(1_000) })
    try {
      const first = await events.stream.next()
      expect(first.value).toMatchObject({ payload: { type: "server.connected" } })
    } finally {
      await events.stream.return(undefined)
    }

    const log = await sdk.app.log({ service: "httpapi-sdk-test", level: "info", message: "hello" })
    expect(log.response.status).toBe(200)
    expect(log.data).toBe(true)

    await expectStatus(sdk.auth.set({ providerID: "test" }), 400)
  })

  test("uses the generated SDK for safe instance routes", async () => {
    await using tmp = await tmpdir({
      config: { formatter: false, lsp: false },
      init: (dir) => Bun.write(path.join(dir, "hello.txt"), "hello"),
    })
    const sdk = client(tmp.path)

    const file = await sdk.file.read({ path: "hello.txt" })
    expect(file.response.status).toBe(200)
    expect(file.data).toMatchObject({ content: "hello" })

    const session = await sdk.session.create({ title: "sdk" })
    expect(session.response.status).toBe(200)
    expect(session.data).toMatchObject({ title: "sdk" })

    const listed = await sdk.session.list({ roots: true, limit: 10 })
    expect(listed.response.status).toBe(200)
    expect(listed.data?.map((item) => item.id)).toContain(session.data?.id)

    await Promise.all([
      expectStatus(sdk.project.current(), 200),
      expectStatus(sdk.config.get(), 200),
      expectStatus(sdk.config.providers(), 200),
      expectStatus(sdk.find.files({ query: "hello", limit: 10 }), 200),
    ])
  })
})
