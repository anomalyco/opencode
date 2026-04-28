import { afterEach, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AuthMiddleware, ErrorMiddleware } from "../../src/server/middleware"
import * as Log from "@opencode-ai/core/util/log"

void Log.init({ print: false })

const original = {
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
}

afterEach(() => {
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
})

function app() {
  return new Hono()
    .onError(ErrorMiddleware)
    .use(AuthMiddleware)
    .get("/probe", (c) => c.text("ok"))
}

function authorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

describe("AuthMiddleware", () => {
  // Regression: hono's basicAuth returns its 401 Response without a
  // Content-Type. Bun's HTTP serializer then defaults to
  // `application/octet-stream`, which Chromium briefly treats as a download
  // attachment before settling on the basic-auth dialog. AuthMiddleware
  // wraps basicAuth so the 401 carries text/plain and preserves the
  // WWW-Authenticate header. Refs upstream issue anomalyco/opencode#18325.
  test("401 carries text/plain Content-Type when credentials are missing", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"

    const response = await app().request("/probe")

    expect(response.status).toBe(401)
    const contentType = response.headers.get("content-type") ?? ""
    expect(contentType).toContain("text/plain")
    expect(contentType).not.toContain("octet-stream")
    expect(response.headers.get("www-authenticate")).toContain("Basic")
    expect(await response.text()).toBe("Unauthorized")
  })

  test("401 carries text/plain Content-Type when credentials are wrong", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"

    const response = await app().request("/probe", {
      headers: { authorization: authorization("opencode", "wrong") },
    })

    expect(response.status).toBe(401)
    const contentType = response.headers.get("content-type") ?? ""
    expect(contentType).toContain("text/plain")
    expect(contentType).not.toContain("octet-stream")
  })

  test("authenticated requests pass through unchanged", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"

    const response = await app().request("/probe", {
      headers: { authorization: authorization("opencode", "secret") },
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("ok")
  })

  test("requests pass through when no password is set", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = undefined

    const response = await app().request("/probe")

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("ok")
  })

  test("CORS preflight bypasses auth", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"

    const response = await app().request("/probe", { method: "OPTIONS" })

    // OPTIONS hits next() with no GET handler matching → 404, not 401.
    // The point is that auth did not block it.
    expect(response.status).not.toBe(401)
  })

  test("auth_token query parameter is accepted as credentials", async () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"

    const token = Buffer.from("opencode:secret").toString("base64")
    const response = await app().request(`/probe?auth_token=${token}`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("ok")
  })
})
