import { describe, expect, test } from "bun:test"
import { parseRepositoryClaim } from "../src/github"

describe("parseRepositoryClaim", () => {
  test("reads repository identity independently of the legacy subject format", () => {
    expect(
      parseRepositoryClaim({
        repository: "octocat/my-repo",
        sub: "repo:octocat/my-repo:ref:refs/heads/main",
      }),
    ).toEqual({ owner: "octocat", repo: "my-repo" })
  })

  test("reads repository identity with an immutable subject format", () => {
    expect(
      parseRepositoryClaim({
        repository: "octocat/my-repo",
        sub: "repo:octocat@123456/my-repo@456789:ref:refs/heads/main",
      }),
    ).toEqual({ owner: "octocat", repo: "my-repo" })
  })

  test("rejects a missing repository claim", () => {
    expect(() => parseRepositoryClaim({})).toThrow("Repository claim is missing")
  })

  test("rejects an invalid repository claim", () => {
    expect(() => parseRepositoryClaim({ repository: "octocat" })).toThrow("Repository claim is invalid")
  })
})
