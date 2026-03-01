import { describe, expect, test } from "bun:test"
import * as config from "../config"

describe("config", () => {
  test("JULES_BASE points to googleapis", () => {
    expect(config.JULES_BASE).toBe("https://jules.googleapis.com/v1alpha")
  })

  test("JULES_HEADER is x-goog-api-key", () => {
    expect(config.JULES_HEADER).toBe("x-goog-api-key")
  })

  test("JULES_TIMEOUT is 30 seconds", () => {
    expect(config.JULES_TIMEOUT).toBe(30_000)
  })
})

describe("url", () => {
  test("builds full URL from path", () => {
    expect(config.url("/sessions")).toBe("https://jules.googleapis.com/v1alpha/sessions")
  })

  test("builds URL with nested path", () => {
    expect(config.url("/sessions/123/activities")).toBe("https://jules.googleapis.com/v1alpha/sessions/123/activities")
  })
})

describe("headers", () => {
  test("returns headers with API key", () => {
    const h = config.headers("test-key")
    expect(h["x-goog-api-key"]).toBe("test-key")
    expect(h["Content-Type"]).toBe("application/json")
  })
})

describe("key", () => {
  test("extracts key from request headers", () => {
    const request = new Request("http://localhost", {
      headers: { "x-goog-api-key": "my-key" },
    })
    expect(config.key(request)).toBe("my-key")
  })

  test("returns undefined when header missing", () => {
    const request = new Request("http://localhost")
    expect(config.key(request)).toBeUndefined()
  })
})
