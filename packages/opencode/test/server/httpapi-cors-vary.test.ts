import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

function app(experimental: boolean) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = experimental
  return experimental ? Server.Default().app : Server.Legacy().app
}

const PREFLIGHT_HEADERS = {
  origin: "http://localhost:3000",
  "access-control-request-method": "POST",
  "access-control-request-headers": "content-type, x-opencode-directory",
}

// effect-smol's HttpMiddleware.cors overwrites `Vary: Origin` with
// `Vary: Access-Control-Request-Headers` on OPTIONS preflight responses
// (the two share the same record key during the spread). With dynamic
// origin echoing, missing Vary: Origin lets shared caches serve a preflight
// cached for one origin against a different origin. corsVaryFixLayer
// restores the merged form.
describe("CORS preflight Vary header", () => {
  test("Hono backend preflight Vary contains Origin", async () => {
    const response = await app(false).request("/global/config", {
      method: "OPTIONS",
      headers: PREFLIGHT_HEADERS,
    })

    expect([200, 204]).toContain(response.status)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    expect((response.headers.get("vary") ?? "").toLowerCase()).toContain("origin")
  })

  test("HTTP API backend preflight Vary contains Origin", async () => {
    const response = await app(true).request("/global/config", {
      method: "OPTIONS",
      headers: PREFLIGHT_HEADERS,
    })

    expect([200, 204]).toContain(response.status)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    expect((response.headers.get("vary") ?? "").toLowerCase()).toContain("origin")
  })

  test("HTTP API backend preflight Vary still preserves Access-Control-Request-Headers", async () => {
    const response = await app(true).request("/global/config", {
      method: "OPTIONS",
      headers: PREFLIGHT_HEADERS,
    })

    const vary = (response.headers.get("vary") ?? "").toLowerCase()
    expect(vary).toContain("origin")
    expect(vary).toContain("access-control-request-headers")
  })

  test("HTTP API backend does not duplicate Origin in Vary", async () => {
    const response = await app(true).request("/global/config", {
      method: "OPTIONS",
      headers: PREFLIGHT_HEADERS,
    })

    const vary = response.headers.get("vary") ?? ""
    const originCount = vary
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s === "origin").length
    expect(originCount).toBe(1)
  })
})
