import { describe, expect, test } from "bun:test"
import { sessionNewMeta, sessionNewPane } from "./session-new-view-layout"

describe("session new layout", () => {
  test("keeps regular projects aligned with session content width", () => {
    expect(sessionNewMeta(false)).toBe("md:max-w-200 md:mx-auto 2xl:max-w-[1000px]")
  })

  test("keeps extra agents on wide layout", () => {
    expect(sessionNewMeta(true)).toBe("")
  })

  test("expands extra agent pane by viewport width", () => {
    expect(sessionNewPane(1200)).toBe("64rem")
    expect(sessionNewPane(1300)).toBe("72rem")
    expect(sessionNewPane(1600)).toBe("80rem")
    expect(sessionNewPane(1900)).toBe("88rem")
    expect(sessionNewPane(2300)).toBe("96rem")
  })
})
