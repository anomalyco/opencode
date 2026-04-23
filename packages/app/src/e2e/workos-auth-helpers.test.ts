import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { e2eAppOrigin } from "../../e2e/workos-auth"

describe("e2eAppOrigin (no network)", () => {
  const prev: Record<string, string | undefined> = {}

  beforeEach(() => {
    prev.PLAYWRIGHT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL
  })

  afterEach(() => {
    if (prev.PLAYWRIGHT_BASE_URL === undefined) delete process.env.PLAYWRIGHT_BASE_URL
    else process.env.PLAYWRIGHT_BASE_URL = prev.PLAYWRIGHT_BASE_URL
  })

  test("uses PLAYWRIGHT_BASE_URL when set", () => {
    process.env.PLAYWRIGHT_BASE_URL = "http://127.0.0.1:4000/"
    expect(e2eAppOrigin()).toBe("http://127.0.0.1:4000")
  })
})
