import { describe, expect, test } from "bun:test"
import { shouldNotify } from "../../src/cli/upgrade"

const base = { autoupdate: undefined, disabled: false, always: false, current: "1.4.0", latest: "1.4.1" }

describe("upgrade check", () => {
  test("notifies about every newer release, including patches", () => {
    expect(shouldNotify(base)).toBe(true)
    expect(shouldNotify({ ...base, latest: "2.0.0" })).toBe(true)
  })

  test("treats true and notify the same", () => {
    expect(shouldNotify({ ...base, autoupdate: true })).toBe(true)
    expect(shouldNotify({ ...base, autoupdate: "notify" })).toBe(true)
  })

  test("does not notify when already on the latest version", () => {
    expect(shouldNotify({ ...base, latest: "1.4.0" })).toBe(false)
  })

  test("never notifies when update checks are disabled", () => {
    expect(shouldNotify({ ...base, autoupdate: false })).toBe(false)
    expect(shouldNotify({ ...base, disabled: true, always: true })).toBe(false)
  })

  test("always-notify flag forces a notice for the current version", () => {
    expect(shouldNotify({ ...base, latest: "1.4.0", always: true })).toBe(true)
  })
})
