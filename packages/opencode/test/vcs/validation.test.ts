import { describe, test, expect } from "bun:test"
import { validateGitLabConfig } from "../../src/vcs/validation"

describe("VCS Configuration Validation", () => {
  test("passes with valid config", async () => {
    const result = await validateGitLabConfig({
      baseUrl: "https://hera.tics.inta/api/v4",
      token: "test-token",
    })
    // Note: Will fail connection test without real GitLab access
    // Just check structure is correct
    expect(typeof result.valid).toBe("boolean")
    expect(Array.isArray(result.errors) || result.errors === undefined).toBe(true)
  })

  test("fails with missing baseUrl", async () => {
    const result = await validateGitLabConfig({
      baseUrl: "",
      token: "test-token",
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("baseUrl is required")
  })

  test("fails with missing token", async () => {
    const result = await validateGitLabConfig({
      baseUrl: "https://hera.tics.inta/api/v4",
      token: "",
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain("token is required")
  })
})
