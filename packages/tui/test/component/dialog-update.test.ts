import { describe, expect, test } from "bun:test"
import { updateTargets } from "../../src/component/dialog-update"
import { isVersionGreater } from "../../src/context/update-notification"

describe("dialog update", () => {
  test("offers OpenCode 2 and the latest OpenCode 1 release when an update exists", () => {
    expect(updateTargets({ current: "1.4.0", latest: "1.4.2" })).toEqual([
      { type: "major" },
      { type: "latest", version: "1.4.2" },
    ])
  })

  test("only offers OpenCode 2 when OpenCode 1 is up to date", () => {
    expect(updateTargets({ current: "1.4.2", latest: "1.4.2" })).toEqual([{ type: "major" }])
  })

  test("still offers OpenCode 2 when the update check fails", () => {
    expect(updateTargets({ current: "1.4.2" })).toEqual([{ type: "major" }])
    expect(updateTargets(undefined)).toEqual([{ type: "major" }])
  })

  test("hides skipped versions until a newer one is released", () => {
    expect(isVersionGreater("1.4.2", "1.4.2")).toBe(false)
    expect(isVersionGreater("1.4.3", "1.4.2")).toBe(true)
    expect(isVersionGreater("1.5.0", "1.10.0")).toBe(false)
    expect(isVersionGreater("1.4.2", "1.4.2-beta.1")).toBe(true)
  })
})
