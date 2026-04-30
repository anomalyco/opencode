import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { Server } from "../../src/server/server"

void Log.init({ print: false })

const original = {
  OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
  envPassword: process.env.OPENCODE_SERVER_PASSWORD,
  envUsername: process.env.OPENCODE_SERVER_USERNAME,
  fetch: globalThis.fetch,
}

afterEach(() => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original.OPENCODE_EXPERIMENTAL_HTTPAPI
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  restoreEnv("OPENCODE_SERVER_PASSWORD", original.envPassword)
  restoreEnv("OPENCODE_SERVER_USERNAME", original.envUsername)
  globalThis.fetch = original.fetch
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

function app(input?: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    ExperimentalHttpApiServer.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            OPENCODE_SERVER_PASSWORD: input?.password,
            OPENCODE_SERVER_USERNAME: input?.username,
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        ExperimentalHttpApiServer.context,
      )
    },
  }
}

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

  test("requires server password for the web UI", async () => {
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    globalThis.fetch = (() => {
      throw new Error("UI fallback should not run before auth")
    }) as unknown as typeof fetch

    const response = await app({ password: "secret", username: "opencode" }).request("/")

    expect(response.status).toBe(401)
  })

  test("accepts auth token for the web UI", async () => {
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("<html>opencode</html>", { headers: { "content-type": "text/html" } }),
      )) as unknown as typeof fetch

    const response = await app({ password: "secret", username: "opencode" }).request(
      `/?auth_token=${btoa("opencode:secret")}`,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("<html>opencode</html>")
  })

  test("accepts basic auth for the web UI", async () => {
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    globalThis.fetch = (() => Promise.resolve(new Response("ui"))) as unknown as typeof fetch

    const response = await app({ password: "secret", username: "opencode" }).request("/", {
      headers: { authorization: `Basic ${btoa("opencode:secret")}` },
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("ui")
  })

  test("allows web UI preflight without auth", async () => {
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
    globalThis.fetch = (() => {
      throw new Error("CORS preflight should not hit the UI proxy")
    }) as unknown as typeof fetch

    const response = await app({ password: "secret", username: "opencode" }).request("/", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
  })
})
