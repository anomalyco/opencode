import { describe, expect, test } from "bun:test"
import { parseRepositoryClaim } from "../src/github"

describe("parseRepositoryClaim", () => {
  test("reads repository identity with a legacy subject", () => {
    expect(
      parseRepositoryClaim({
        repository: "octocat/my-repo",
        sub: "repo:octocat/my-repo:ref:refs/heads/main",
      }),
    ).toEqual({ owner: "octocat", repo: "my-repo" })
  })

  test("reads repository identity with an immutable subject", () => {
    expect(
      parseRepositoryClaim({
        repository: "octocat/my-repo",
        sub: "repo:octocat@123456/my-repo@456789:ref:refs/heads/main",
      }),
    ).toEqual({ owner: "octocat", repo: "my-repo" })
  })

  test("does not depend on a repository path in a customized subject", () => {
    expect(
      parseRepositoryClaim({
        repository: "octocat/my-repo",
        sub: "repository_owner:octocat:repository_visibility:private",
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
