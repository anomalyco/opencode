import { describe, expect, test } from "bun:test"
import { errorDescriptionKey } from "./error-description"

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
