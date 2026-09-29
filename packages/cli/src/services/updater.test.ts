import { describe, expect, test } from "bun:test"
import { action } from "./updater-action"
import { decodePolicy, replacesExecutable } from "./updater"

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

  test("reports every available release", () => {
    expect(action("1.2.3", "1.2.4", "notify")).toBe("notify")
    expect(action("1.2.3", "1.3.0", "notify")).toBe("notify")
    expect(action("1.2.3", "2.0.0", "notify")).toBe("notify")
    expect(action("1.2.3", "1.2.3", "notify")).toBe("none")
  })

  test("automatically installs every available release when enabled", () => {
    expect(action("1.2.3", "1.2.4", "auto")).toBe("auto")
    expect(action("1.2.3", "1.2.3", "auto")).toBe("none")
  })

  test("skips when updates are disabled", () => {
    expect(action("1.2.3", "1.2.4", "disable")).toBe("none")
  })

  test("reports up-to-date only when versions match", () => {
    expect(action("1.2.3", "1.2.3", "notify")).toBe("none")
  })

  test("reports when latest is lower (rollback)", () => {
    expect(action("1.2.4", "1.2.3", "notify")).toBe("notify")
  })

  test("accepts strict release version variants", () => {
    expect(action("v1.2.3", " 1.2.4\n", "notify")).toBe("notify")
    expect(action("1.2.3-alpha.1", "1.2.3-alpha.2", "notify")).toBe("notify")
    expect(action("0.0.0-dev-17403", "0.0.0-dev-17403.2", "notify")).toBe("notify")
    expect(action("0.0.0-next-17403", "0.0.0-beta-17404", "notify")).toBe("notify")
    expect(action("1.2.3+old", "1.2.3+new", "notify")).toBe("none")
    expect(action("v1.2.3+old", "1.2.3", "notify")).toBe("none")
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
    invalid.forEach((version) => expect(action("1.2.3", version, "notify"), version).toBe("none"))
  })

  test("handles numeric limits without losing precision", () => {
    expect(action("9007199254740991.0.0", "9007199254740991.0.1", "notify")).toBe("notify")
    expect(action("9007199254740990.0.0", "9007199254740991.0.0", "notify")).toBe("notify")
  })

  test("preserves equality for oversized numeric prerelease identifiers", () => {
    expect(action("1.0.0-9007199254740992", "1.0.0-9007199254740993", "notify")).toBe("none")
    expect(action("1.0.0-9007199254740991", "1.0.0-9007199254740992", "notify")).toBe("notify")
  })

  test("rejects versions longer than semver's limit before trimming", () => {
    expect(action("1.2.3", `${" ".repeat(251)}1.2.3`, "notify")).toBe("none")
    expect(action("1.2.3", `1.2.4+${"a".repeat(250)}`, "notify")).toBe("notify")
  })
})

describe("replacesExecutable", () => {
  const root = "/home/user/.npm-global/lib/node_modules"
  const inside = `${root}/@opencode/cli/bin/opencode.exe`

  test("accepts a binary the manager can reinstall", () => {
    expect(replacesExecutable(root, inside)).toBe(true)
  })

  test("rejects a binary outside the manager's global root", () => {
    expect(replacesExecutable(root, "/home/user/.local/lib/node_modules/@opencode/cli/bin/opencode.exe")).toBe(
      false,
    )
  })

  test("rejects a sibling directory that merely shares the root prefix", () => {
    expect(replacesExecutable(root, `${root}-backup/@opencode/cli/bin/opencode.exe`)).toBe(false)
  })

  test("rejects the global root itself", () => {
    expect(replacesExecutable(root, root)).toBe(false)
  })

  test("keeps previous behaviour when the root cannot be read", () => {
    expect(replacesExecutable(undefined, inside)).toBe(true)
    expect(replacesExecutable("", inside)).toBe(true)
    expect(replacesExecutable("   \n", inside)).toBe(true)
  })

  test("resolves relative and untrimmed roots", () => {
    expect(replacesExecutable(`  ${root}\n`, inside)).toBe(true)
    expect(replacesExecutable("lib/node_modules", "lib/node_modules/@opencode/cli/bin/opencode.exe")).toBe(true)
  })
})
