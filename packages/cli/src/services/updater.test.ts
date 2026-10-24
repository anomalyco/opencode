import { describe, expect, test } from "bun:test"
import { action } from "./updater-action"
import { decodePolicy, evaluateProbes } from "./updater"

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

describe("evaluateProbes", () => {
  const result = (code: number, stdout = "", stderr = "") => ({ type: "result" as const, code, stdout, stderr })
  const error = (detail: string) => ({ type: "error" as const, detail })

  test("selects the first probe whose output names the installed package", () => {
    const evaluated = evaluateProbes(
      [
        { method: "npm", outcome: result(1) },
        { method: "pnpm", outcome: result(0, "└── @opencode/cli@2.0.18") },
      ],
      "@opencode/cli",
    )

    expect(evaluated.method).toBe("pnpm")
    expect(evaluated.report).toEqual(["npm: exit 1", "pnpm: matched"])
  })

  test("does not select a probe that never produced output", () => {
    const evaluated = evaluateProbes([{ method: "npm", outcome: error("Timed out") }], "@opencode/cli")

    expect(evaluated.method).toBeUndefined()
    expect(evaluated.report).toEqual(["npm: Timed out"])
  })

  test("requires an exact name from Vite+ instead of a substring", () => {
    const listed = JSON.stringify([{ name: "@opencode/cli" }])

    expect(evaluateProbes([{ method: "vp", outcome: result(0, listed) }], "@opencode/cli").method).toBe("vp")
    expect(
      evaluateProbes([{ method: "vp", outcome: result(1, "No packages matching @opencode/cli") }], "@opencode/cli")
        .method,
    ).toBeUndefined()
  })

  test("leaves the method undetected when every probe runs without a match", () => {
    const evaluated = evaluateProbes(
      [
        { method: "bun", outcome: result(0, "bun@1.4.2") },
        { method: "yarn", outcome: result(1, "") },
      ],
      "@opencode/cli",
    )

    expect(evaluated.method).toBeUndefined()
    expect(evaluated.report).toEqual(["bun: exit 0", "yarn: exit 1"])
  })
})
