import { describe, expect, it } from "bun:test"
import { sanitizeForGitHubOutput } from "./sanitize"

describe("sanitizeForGitHubOutput", () => {
  it("redacts sensitive env assignments", () => {
    const result = sanitizeForGitHubOutput(
      ["GITHUB_TOKEN=ghs_123456789012345678901234567890123456", "ZHIPU_API_KEY: secret", "SAFE_VAR=value"].join("\n"),
    )
    expect(result).toContain("GITHUB_TOKEN=***")
    expect(result).toContain("ZHIPU_API_KEY: ***")
    expect(result).toContain("SAFE_VAR=value")
  })

  it("redacts inline token formats", () => {
    const result = sanitizeForGitHubOutput(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc1234567890.xyz1234567890",
    )
    expect(result).toContain("Authorization: Bearer ***")
  })

  it("redacts token query params", () => {
    const result = sanitizeForGitHubOutput("url=https://example.com?a=1&access_token=abc12345678901234567890&x=2")
    expect(result).toContain("access_token=***")
  })
})
