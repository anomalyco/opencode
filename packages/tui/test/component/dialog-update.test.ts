import { describe, expect, test } from "bun:test"
import { updateTarget } from "../../src/component/dialog-update"
import { DISMISS_DURATION, visibleNotice } from "../../src/context/update-notification"

describe("dialog update", () => {
  test("uses the normal OpenCode 1 update when a newer release exists", () => {
    expect(updateTarget({ current: "1.4.0", latest: "1.4.2" })).toEqual({ type: "latest", version: "1.4.2" })
  })

  test("only offers OpenCode 2 when OpenCode 1 is up to date", () => {
    expect(updateTarget({ current: "1.4.2", latest: "1.4.2" })).toEqual({ type: "major" })
  })

  test("hides the notice for a week after it is dismissed", () => {
    const notice = { type: "available" as const, version: "1.4.2" }
    const now = 1_000_000
    expect(visibleNotice(notice, undefined, now)).toEqual(notice)
    expect(visibleNotice(notice, now + DISMISS_DURATION, now)).toBeUndefined()
    expect(visibleNotice({ type: "major" }, now + DISMISS_DURATION, now + DISMISS_DURATION - 1)).toBeUndefined()
    expect(visibleNotice({ type: "major" }, now + DISMISS_DURATION, now + DISMISS_DURATION)).toEqual({ type: "major" })
    expect(DISMISS_DURATION).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
