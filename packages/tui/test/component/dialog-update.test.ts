import { describe, expect, test } from "bun:test"
import { updateTarget } from "../../src/component/dialog-update"
import { isVersionGreater } from "../../src/context/update-notification"

describe("dialog update", () => {
  test("uses the normal OpenCode 1 update when a newer release exists", () => {
    expect(updateTarget({ current: "1.4.0", latest: "1.4.2" })).toEqual({ type: "latest", version: "1.4.2" })
  })

  test("only offers OpenCode 2 when OpenCode 1 is up to date", () => {
    expect(updateTarget({ current: "1.4.2", latest: "1.4.2" })).toEqual({ type: "major" })
  })

  test("hides skipped versions until a newer one is released", () => {
    expect(isVersionGreater("1.4.2", "1.4.2")).toBe(false)
    expect(isVersionGreater("1.4.3", "1.4.2")).toBe(true)
    expect(isVersionGreater("1.5.0", "1.10.0")).toBe(false)
    expect(isVersionGreater("1.4.2", "1.4.2-beta.1")).toBe(true)
  })
})
