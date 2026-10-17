import { afterEach, expect, test } from "bun:test"
import { updaterEnabled } from "./enabled"

const original = process.env.OPENCODE_DISABLE_AUTOUPDATE

afterEach(() => {
  if (original === undefined) delete process.env.OPENCODE_DISABLE_AUTOUPDATE
  else process.env.OPENCODE_DISABLE_AUTOUPDATE = original
})

test("runs the updater only for packaged non-dev builds without OPENCODE_DISABLE_AUTOUPDATE", () => {
  const cases: readonly (readonly [boolean, string, string | undefined, boolean])[] = [
    [false, "prod", undefined, false],
    [true, "dev", undefined, false],
    [true, "beta", undefined, true],
    [true, "prod", undefined, true],
    [true, "prod", "1", false],
    [true, "prod", "true", false],
    [true, "prod", "TRUE", false],
    [true, "prod", "0", true],
    [true, "prod", "false", true],
  ]

  for (const [packaged, channel, value, expected] of cases) {
    if (value === undefined) delete process.env.OPENCODE_DISABLE_AUTOUPDATE
    else process.env.OPENCODE_DISABLE_AUTOUPDATE = value

    expect(updaterEnabled({ packaged, channel })).toBe(expected)
  }
})
