import { describe, expect, test } from "bun:test"
import { parseGithubOidcSub } from "./github-oidc"

describe("parseGithubOidcSub", () => {
  test("parses classic OIDC subject", () => {
    expect(parseGithubOidcSub("repo:octocat/my-repo:ref:refs/heads/main")).toEqual({
      owner: "octocat",
      repo: "my-repo",
    })
  })

  test("strips immutable owner and repo id suffixes", () => {
    expect(parseGithubOidcSub("repo:octocat@123456/my-repo@456789:ref:refs/heads/main")).toEqual({
      owner: "octocat",
      repo: "my-repo",
    })
  })

  test("parses job_workflow_ref style subjects", () => {
    expect(
      parseGithubOidcSub("repo:my-org/my-repo:job_workflow_ref:my-org/my-repo/.github/workflows/ci.yml@refs/heads/main"),
    ).toEqual({
      owner: "my-org",
      repo: "my-repo",
    })
  })

  test("throws on invalid subject", () => {
    expect(() => parseGithubOidcSub("invalid")).toThrow("Invalid OIDC subject")
    expect(() => parseGithubOidcSub("repo:only-owner")).toThrow("Invalid OIDC subject")
  })
})
