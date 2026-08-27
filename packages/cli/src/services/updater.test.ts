import { describe, expect, test } from "bun:test"
import path from "node:path"
import { action } from "./updater-action"
import { decodePolicy } from "./updater"

describe("updater", () => {
  test("remembers successful installs across checks and accepts the next release", async () => {
    // Isolate compiled version constants and the update endpoint from other tests.
    const child = Bun.spawn(
      [
        process.execPath,
        "--define",
        'OPENCODE_VERSION="0.0.0-next-16473"',
        "--define",
        'OPENCODE_CHANNEL="beta"',
        path.join(import.meta.dir, "fixtures/updater.ts"),
      ],
      { env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: "" }, stdout: "pipe", stderr: "pipe" },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, stdout + stderr).toBe(0)
  })

  test("reads autoupdate from JSONC", () => {
    expect(decodePolicy('{ // preference\n "autoupdate": "notify",\n}')).toBe("notify")
    expect(decodePolicy('{ "autoupdate": false }')).toBe(false)
    expect(decodePolicy('{ "autoupdate": "invalid" }')).toBeUndefined()
  })

  test("automatically updates patches and minors", () => {
    expect(action("1.2.3", "1.2.4", true)).toBe("upgrade")
    expect(action("1.2.3", "1.3.0", true)).toBe("upgrade")
  })

  test("reports patches and minors without automatically installing them", () => {
    expect(action("1.2.3", "1.2.4", "notify")).toBe("notify")
    expect(action("1.2.3", "1.3.0", "notify")).toBe("notify")
    expect(action("1.2.3", "1.2.3", "notify")).toBe("none")
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

  test("skips an installed update but still accepts the next release", () => {
    const current = "0.0.0-next-16473"
    const installed = "0.0.0-beta-17498"
    expect(action(current, installed, true)).toBe("upgrade")
    expect(action(current, installed, true, installed)).toBe("none")
    expect(action(current, "0.0.0-beta-17499", true, installed)).toBe("upgrade")
  })

  test("upgrades when latest is lower (rollback)", () => {
    expect(action("1.2.4", "1.2.3", true)).toBe("upgrade")
  })

  test("accepts strict release version variants", () => {
    expect(action("v1.2.3", " 1.2.4\n", true)).toBe("upgrade")
    expect(action("1.2.3-alpha.1", "1.2.3-alpha.2", true)).toBe("upgrade")
    expect(action("0.0.0-dev-17403", "0.0.0-dev-17403.2", true)).toBe("upgrade")
    expect(action("0.0.0-next-17403", "0.0.0-beta-17404", true)).toBe("upgrade")
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
