import { describe, expect, test } from "bun:test"
import { action } from "./updater-action"
import { decodePolicy } from "./updater"

describe("updater", () => {
  test("reads update policy from JSONC", () => {
    expect(decodePolicy('{ // preference\n "update": "notify",\n}')).toBe("notify")
    expect(decodePolicy('{ "update": "disable" }')).toBe("disable")
    expect(decodePolicy('{ "update": "auto" }')).toBe("auto")
    expect(decodePolicy('{ "update": "invalid" }')).toBeUndefined()
  })

  test("maps the v1 update policy", () => {
    expect(decodePolicy('{ "autoupdate": false }')).toBe("disable")
    expect(decodePolicy('{ "autoupdate": "notify" }')).toBe("notify")
    expect(decodePolicy('{ "autoupdate": true }')).toBe("auto")
  })

  test("automatically updates patches and minors", () => {
    expect(action("1.2.3", "1.2.4", "auto")).toBe("upgrade")
    expect(action("1.2.3", "1.3.0", "auto")).toBe("upgrade")
  })

  test("reports patches and minors without automatically installing them", () => {
    expect(action("1.2.3", "1.2.4", "notify")).toBe("notify")
    expect(action("1.2.3", "1.3.0", "notify")).toBe("notify")
    expect(action("1.2.3", "2.0.0", "notify")).toBe("notify")
    expect(action("1.2.3", "1.2.3", "notify")).toBe("none")
  })

  test("skips when updates are disabled", () => {
    expect(action("1.2.3", "1.2.4", "disable")).toBe("none")
  })

  test("reports majors instead of automatically installing them", () => {
    expect(action("1.2.3", "2.0.0", "auto")).toBe("notify")
  })

  test("reports up-to-date only when versions match", () => {
    expect(action("1.2.3", "1.2.3", "auto")).toBe("none")
  })

  test("upgrades when latest is lower (rollback)", () => {
    expect(action("1.2.4", "1.2.3", "auto")).toBe("upgrade")
  })

  test("accepts strict release version variants", () => {
    expect(action("v1.2.3", " 1.2.4\n", "auto")).toBe("upgrade")
    expect(action("1.2.3-alpha.1", "1.2.3-alpha.2", "auto")).toBe("upgrade")
    expect(action("0.0.0-dev-17403", "0.0.0-dev-17403.2", "auto")).toBe("upgrade")
    expect(action("0.0.0-next-17403", "0.0.0-beta-17404", "auto")).toBe("upgrade")
    expect(action("1.2.3+old", "1.2.3+new", "auto")).toBe("none")
    expect(action("v1.2.3+old", "1.2.3", "auto")).toBe("none")
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
    invalid.forEach((version) => expect(action("1.2.3", version, "auto"), version).toBe("none"))
  })

  test("handles numeric limits without losing precision", () => {
    expect(action("9007199254740991.0.0", "9007199254740991.0.1", "auto")).toBe("upgrade")
    expect(action("9007199254740990.0.0", "9007199254740991.0.0", "auto")).toBe("notify")
  })

  test("preserves equality for oversized numeric prerelease identifiers", () => {
    expect(action("1.0.0-9007199254740992", "1.0.0-9007199254740993", "auto")).toBe("none")
    expect(action("1.0.0-9007199254740991", "1.0.0-9007199254740992", "auto")).toBe("upgrade")
  })

  test("rejects versions longer than semver's limit before trimming", () => {
    expect(action("1.2.3", `${" ".repeat(251)}1.2.3`, "auto")).toBe("none")
    expect(action("1.2.3", `1.2.4+${"a".repeat(250)}`, "auto")).toBe("upgrade")
  })
})
