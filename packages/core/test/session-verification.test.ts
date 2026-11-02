import { describe, expect, test } from "bun:test"
import { SessionVerification } from "@opencode/core/session/verification"

describe("SessionVerification.resolveScript", () => {
  test("prefers the first conventional script the package defines", () => {
    expect(
      SessionVerification.resolveScript({
        scripts: { lint: "oxlint", typecheck: "tsc", check: "bun run check", test: "bun test" },
      }),
    ).toBe("test")
    expect(SessionVerification.resolveScript({ scripts: { lint: "oxlint", check: "bun run check" } })).toBe("check")
    expect(SessionVerification.resolveScript({ scripts: { typecheck: "tsc", lint: "oxlint" } })).toBe("typecheck")
    expect(SessionVerification.resolveScript({ scripts: { lint: "oxlint" } })).toBe("lint")
  })

  test("ignores scripts whose value is not a string", () => {
    expect(SessionVerification.resolveScript({ scripts: { test: null, check: 1, lint: "oxlint" } })).toBe("lint")
  })

  test("returns undefined without a scripts object", () => {
    expect(SessionVerification.resolveScript(undefined)).toBeUndefined()
    expect(SessionVerification.resolveScript({})).toBeUndefined()
    expect(SessionVerification.resolveScript({ scripts: "bun test" })).toBeUndefined()
    expect(SessionVerification.resolveScript({ scripts: {} })).toBeUndefined()
  })
})

describe("SessionVerification.formatCommand", () => {
  test("uses the short yarn script form and a run subcommand elsewhere", () => {
    expect(SessionVerification.formatCommand("bun", "test")).toBe("bun run test")
    expect(SessionVerification.formatCommand("pnpm", "check")).toBe("pnpm run check")
    expect(SessionVerification.formatCommand("npm", "typecheck")).toBe("npm run typecheck")
    expect(SessionVerification.formatCommand("yarn", "lint")).toBe("yarn lint")
  })
})
