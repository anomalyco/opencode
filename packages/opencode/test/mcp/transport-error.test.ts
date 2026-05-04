import { describe, test, expect } from "bun:test"
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { isTransportError } from "../../src/mcp/transport-error"

// Synthetic error shapes are observed from the real-world probe at
// `test/mcp/transport-error-probe.mjs`. Whenever the classifier changes,
// re-run `bun run test:mcp-probe` to confirm these shapes still match reality.

describe("isTransportError — StreamableHTTPError", () => {
  test("code -1 (SDK protocol-level breakage)", () => {
    expect(isTransportError(new StreamableHTTPError(-1, "bad content-type"))).toBe(true)
  })

  test("400 bad request (e.g. server not initialized after restart)", () => {
    expect(isTransportError(new StreamableHTTPError(400, "Bad Request: Server not initialized"))).toBe(true)
  })

  test("404 stale session", () => {
    expect(isTransportError(new StreamableHTTPError(404, "session not found"))).toBe(true)
  })

  test("410 gone", () => {
    expect(isTransportError(new StreamableHTTPError(410, "gone"))).toBe(true)
  })

  test("500 server error", () => {
    expect(isTransportError(new StreamableHTTPError(503, "bad gateway"))).toBe(true)
  })

  test("401 unauthorized belongs to auth flow, not transport", () => {
    expect(isTransportError(new StreamableHTTPError(401, "unauthorized"))).toBe(false)
  })

  test("403 forbidden belongs to auth flow, not transport", () => {
    expect(isTransportError(new StreamableHTTPError(403, "forbidden"))).toBe(false)
  })

  test("undefined code is not transport", () => {
    expect(isTransportError(new StreamableHTTPError(undefined, "no code"))).toBe(false)
  })
})

describe("isTransportError — plain Error with socket code", () => {
  test("Bun PascalCase err.code: ConnectionRefused", () => {
    const e = Object.assign(new Error("Unable to connect. Is the computer able to access the url?"), {
      code: "ConnectionRefused",
    })
    expect(isTransportError(e)).toBe(true)
  })

  test("Bun PascalCase err.code: ConnectionReset", () => {
    const e = Object.assign(new Error("socket reset"), { code: "ConnectionReset" })
    expect(isTransportError(e)).toBe(true)
  })

  test("Node UPPER_SNAKE err.code: ECONNREFUSED", () => {
    const e = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" })
    expect(isTransportError(e)).toBe(true)
  })

  test("Node err.cause.code: ECONNRESET inside fetch failed", () => {
    const e = new Error("fetch failed", { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) })
    expect(isTransportError(e)).toBe(true)
  })

  test("Undici err.cause.code: UND_ERR_SOCKET", () => {
    const e = new Error("fetch failed", { cause: Object.assign(new Error(""), { code: "UND_ERR_SOCKET" }) })
    expect(isTransportError(e)).toBe(true)
  })

  test('message fallback: "fetch failed" with no code', () => {
    expect(isTransportError(new Error("fetch failed"))).toBe(true)
  })

  test('message fallback: "Unable to connect"', () => {
    expect(isTransportError(new Error("Unable to connect. Is the computer able to access the url?"))).toBe(true)
  })
})

describe("isTransportError — non-transport cases", () => {
  test("unknown err.code is ignored", () => {
    const e = Object.assign(new Error("nope"), { code: "SOME_RANDOM_CODE" })
    expect(isTransportError(e)).toBe(false)
  })

  test("business error without code", () => {
    expect(isTransportError(new Error("tool 'echo' not found"))).toBe(false)
  })

  test("non-Error value (string)", () => {
    expect(isTransportError("boom")).toBe(false)
  })

  test("non-Error value (plain object with code)", () => {
    expect(isTransportError({ code: "ConnectionRefused" })).toBe(false)
  })

  test("null/undefined", () => {
    expect(isTransportError(null)).toBe(false)
    expect(isTransportError(undefined)).toBe(false)
  })
})
