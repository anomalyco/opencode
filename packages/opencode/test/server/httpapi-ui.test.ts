import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"

void Log.init({ print: false })

const original = {
  OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
  fetch: globalThis.fetch,
}

afterEach(() => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
  globalThis.fetch = original.fetch
})

describe("HttpApi UI fallback", () => {
  test("serves the web UI through the experimental backend", async () => {
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    let proxiedUrl: string | undefined
    globalThis.fetch = ((input: RequestInfo | URL) => {
      proxiedUrl = String(input instanceof Request ? input.url : input)
      return Promise.resolve(new Response("<html>opencode</html>", { headers: { "content-type": "text/html" } }))
    }) as typeof fetch

    const response = await Server.Default().app.request("/")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(await response.text()).toBe("<html>opencode</html>")
    expect(proxiedUrl).toBe("https://app.opencode.ai/")
  })

  test("keeps matched API routes ahead of the UI fallback", async () => {
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    globalThis.fetch = (() => {
      throw new Error("UI fallback should not handle matched API routes")
    }) as unknown as typeof fetch

    const response = await Server.Default().app.request("/session/nope")

    expect(response.status).toBe(404)
  })
})
