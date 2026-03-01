import { describe, expect, test } from "bun:test"
import * as client from "../client/JulesClient"
import * as routes from "../routes/jules"

const KEY = process.env.JULES_API_KEY
const LIVE = KEY !== undefined && KEY.length > 0

describe.skipIf(!LIVE)("live: client", () => {
  test("sources returns connected repos", async () => {
    const result = await client.sources(KEY!)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Array.isArray(result.data.sources)).toBe(true)
      expect(result.data.sources.length).toBeGreaterThan(0)
    }
  })

  test("get session returns 404 for bogus id", async () => {
    const result = await client.get(KEY!, "nonexistent-session-id-000")
    expect(result.ok).toBe(false)
  })
})

describe.skipIf(!LIVE)("live: routes", () => {
  test("sources route proxies to Jules API", async () => {
    const request = new Request("http://localhost/v1/jules/sources", {
      headers: { "x-goog-api-key": KEY! },
    })
    const response = await routes.sources(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.sources)).toBe(true)
    expect(body.sources.length).toBeGreaterThan(0)
  })

  test("sources route rejects missing key", async () => {
    const request = new Request("http://localhost/v1/jules/sources")
    const response = await routes.sources(request)
    expect(response.status).toBe(401)
  })

  test("session route returns error for bogus id", async () => {
    const request = new Request("http://localhost/v1/jules/sessions/bogus", {
      headers: { "x-goog-api-key": KEY! },
    })
    const response = await routes.session(request, "bogus")
    expect(response.status).not.toBe(200)
  })
})
