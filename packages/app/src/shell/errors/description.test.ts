import { describe, expect, test } from "bun:test"
import { errorDescriptionKey, errorStatus } from "./description"

describe("error description", () => {
  test("describes local server startup errors", () => {
    expect(errorDescriptionKey(Object.assign(new Error("migration failed"), { localServerStartup: true }))).toBe(
      "error.page.description.localServerStartup",
    )
  })

  test("uses the generic description for other errors", () => {
    expect(errorDescriptionKey(new Error("unknown"))).toBe("error.page.description")
    expect(errorDescriptionKey(Object.assign(new Error("unknown"), { localServerStartup: false }))).toBe(
      "error.page.description",
    )
  })
})

describe("error status", () => {
  test("finds status codes in an error cause", () => {
    expect(errorStatus(new Error("UnexpectedStatus", { cause: { status: 502 } }))).toBe(502)
  })

  test("finds status codes in structured error data", () => {
    expect(errorStatus({ name: "APIError", data: { statusCode: 401 } })).toBe(401)
  })

  test("ignores invalid and circular status values", () => {
    const error: { status: number; cause?: unknown } = { status: 99 }
    error.cause = error
    expect(errorStatus(error)).toBeUndefined()
  })
})
