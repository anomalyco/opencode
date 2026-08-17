import { describe, expect, test } from "bun:test"
import { isAllowedCorsOrigin } from "../src/cors"

describe("CORS origin policy", () => {
  test("allows the desktop renderer origin", () => {
    expect(isAllowedCorsOrigin("oc://renderer")).toBe(true)
  })

  test("rejects other custom protocol origins", () => {
    expect(isAllowedCorsOrigin("other://renderer")).toBe(false)
  })
})
