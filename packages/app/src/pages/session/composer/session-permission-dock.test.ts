import { describe, expect, test } from "bun:test"
import { canRememberPermission } from "./session-permission-dock"

describe("canRememberPermission", () => {
  test("hides Always when the request has no persistent resources", () => {
    expect(canRememberPermission({ always: [] })).toBe(false)
    expect(canRememberPermission({ always: ["https://example.com/*"] })).toBe(true)
  })
})
