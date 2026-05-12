import { describe, expect, test } from "bun:test"
import { shellAudit } from "../../src/tool/auditor"

describe("shellAudit", () => {
  test("redacts DEEPSEEK_API_KEY", () => {
    const env = { PATH: "/usr/bin", DEEPSEEK_API_KEY: "sk-1234567890abcdef" }
    const r = shellAudit(env)
    expect(r.redacted).toContain("DEEPSEEK_API_KEY")
    expect(env.DEEPSEEK_API_KEY).toBe("[REDACTED]")
    expect(env.PATH).toBe("/usr/bin")
  })
  test("redacts GITHUB_TOKEN", () => {
    const env = { GITHUB_TOKEN: "ghp_1234567890abcdef" }
    shellAudit(env)
    expect(env.GITHUB_TOKEN).toBe("[REDACTED]")
  })
  test("does not redact short values", () => {
    const env = { TEST_KEY: "short" }
    shellAudit(env)
    expect(env.TEST_KEY).toBe("short")
  })
  test("safe env vars untouched", () => {
    const env = { PATH: "/bin", HOME: "/home", USER: "test" }
    shellAudit(env)
    expect(env.PATH).toBe("/bin")
    expect(env.HOME).toBe("/home")
  })
  test("warning generated for redactions", () => {
    const env = { GITHUB_TOKEN: "ghp_1234567890ab" }
    const r = shellAudit(env)
    expect(r.warning).toContain("GITHUB_TOKEN")
  })
  test("no warning when clean", () => {
    const env = { PATH: "/bin" }
    const r = shellAudit(env)
    expect(r.warning).toBeUndefined()
  })
})
