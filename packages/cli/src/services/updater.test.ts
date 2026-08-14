import { describe, expect, test } from "bun:test"
import { action } from "./updater-action"
import { decodePolicy } from "./updater"

describe("updater", () => {
  test("reads autoupdate from JSONC", () => {
    expect(decodePolicy('{ // preference\n "autoupdate": "notify",\n}')).toBe("notify")
    expect(decodePolicy('{ "autoupdate": false }')).toBe(false)
    expect(decodePolicy('{ "autoupdate": "invalid" }')).toBeUndefined()
  })

  test("automatically updates patches and minors", () => {
    expect(action("1.2.3", "1.2.4", true)).toBe("upgrade")
    expect(action("1.2.3", "1.3.0", true)).toBe("upgrade")
    expect(action("1.2.3", "1.2.4", "notify")).toBe("upgrade")
    expect(action("1.2.3", "1.3.0", "notify")).toBe("upgrade")
  })

  test("skips when autoupdate is disabled", () => {
    expect(action("1.2.3", "1.2.4", false)).toBe("none")
  })

  test("never automatically updates majors", () => {
    expect(action("1.2.3", "2.0.0", true)).toBe("none")
  })

  test("reports up-to-date only when versions match", () => {
    expect(action("1.2.3", "1.2.3", true)).toBe("none")
  })

  test("upgrades when latest is lower (rollback)", () => {
    expect(action("1.2.4", "1.2.3", true)).toBe("upgrade")
  })

  test("accepts strict release version variants", () => {
    expect(action("v1.2.3", " 1.2.4\n", true)).toBe("upgrade")
    expect(action("1.2.3-alpha.1", "1.2.3-alpha.2", true)).toBe("upgrade")
    expect(action("0.0.0-next-17403", "0.0.0-next-17403.2", true)).toBe("upgrade")
    expect(action("1.2.3+old", "1.2.3+new", true)).toBe("none")
    expect(action("v1.2.3+old", "1.2.3", true)).toBe("none")
  })

  test("preserves strict validity", () => {
    const invalid = [
      "=1.2.3",
      "V1.2.3",
      "1.2",
      "1.2.3.4",
      "01.2.3",
      "1.02.3",
      "1.2.03",
      "1.2.3-01",
      "1.2.3-",
      "1.2.3+",
      "1.2.3-alpha..1",
      "1.2.3_alpha",
      "9007199254740992.0.0",
      "0.9007199254740992.0",
      "0.0.9007199254740992",
    ]
    invalid.forEach((version) => expect(action("1.2.3", version, true), version).toBe("none"))
  })

  test("handles numeric limits without losing precision", () => {
    expect(action("9007199254740991.0.0", "9007199254740991.0.1", true)).toBe("upgrade")
    expect(action("9007199254740990.0.0", "9007199254740991.0.0", true)).toBe("none")
  })

  test("preserves equality for oversized numeric prerelease identifiers", () => {
    expect(action("1.0.0-9007199254740992", "1.0.0-9007199254740993", true)).toBe("none")
    expect(action("1.0.0-9007199254740991", "1.0.0-9007199254740992", true)).toBe("upgrade")
  })

  test("rejects versions longer than semver's limit before trimming", () => {
    expect(action("1.2.3", `${" ".repeat(251)}1.2.3`, true)).toBe("none")
    expect(action("1.2.3", `1.2.4+${"a".repeat(250)}`, true)).toBe("upgrade")
  })
})
