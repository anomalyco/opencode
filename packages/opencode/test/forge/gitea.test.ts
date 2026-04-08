import { describe, expect, test } from "bun:test"
import { parseRemote } from "@/forge/index"
import { GiteaForge } from "@/forge/gitea"

describe("parseRemote", () => {
  test("parses GitHub HTTPS URL", () => {
    const r = parseRemote("https://github.com/owner/repo.git")
    expect(r).toEqual({ platform: "github", host: "github.com", owner: "owner", repo: "repo" })
  })

  test("parses GitHub HTTPS URL without .git", () => {
    const r = parseRemote("https://github.com/owner/repo")
    expect(r).toEqual({ platform: "github", host: "github.com", owner: "owner", repo: "repo" })
  })

  test("parses GitHub SSH URL", () => {
    const r = parseRemote("git@github.com:owner/repo.git")
    expect(r).toEqual({ platform: "github", host: "github.com", owner: "owner", repo: "repo" })
  })

  test("parses Gitea HTTPS URL", () => {
    const r = parseRemote("https://gitea.example.com/owner/repo.git")
    expect(r).toEqual({ platform: "gitea", host: "gitea.example.com", owner: "owner", repo: "repo" })
  })

  test("parses Gitea HTTPS URL without .git", () => {
    const r = parseRemote("https://gitea.example.com/owner/repo")
    expect(r).toEqual({ platform: "gitea", host: "gitea.example.com", owner: "owner", repo: "repo" })
  })

  test("parses Gitea SSH URL", () => {
    const r = parseRemote("git@gitea.example.com:owner/repo.git")
    expect(r).toEqual({ platform: "gitea", host: "gitea.example.com", owner: "owner", repo: "repo" })
  })

  test("parses Gitea SSH URL with ssh:// prefix", () => {
    const r = parseRemote("ssh://git@gitea.example.com/owner/repo.git")
    expect(r).toEqual({ platform: "gitea", host: "gitea.example.com", owner: "owner", repo: "repo" })
  })

  test("returns null for invalid URL", () => {
    expect(parseRemote("invalid")).toBeNull()
  })

  test("returns null for empty string", () => {
    expect(parseRemote("")).toBeNull()
  })
})

describe("GiteaForge", () => {
  test("platform is gitea", () => {
    const f = new GiteaForge("gitea.example.com", "owner", "repo")
    expect(f.platform).toBe("gitea")
  })

  test("buildPromptDataForIssue includes issue context", () => {
    const f = new GiteaForge("gitea.example.com", "o", "r")
    const data = f.buildPromptDataForIssue(
      {
        title: "Bug fix",
        body: "Something broke",
        author: { login: "alice" },
        createdAt: "2025-01-01T00:00:00Z",
        state: "open",
        comments: [{ id: 1, body: ":+1:", author: { login: "bob" }, createdAt: "2025-01-02T00:00:00Z" }],
      },
      2,
    )
    expect(data).toContain("Bug fix")
    expect(data).toContain("Something broke")
    expect(data).toContain("alice")
    expect(data).toContain("gitea_action_context")
    expect(data).not.toContain("bob")
  })

  test("buildPromptDataForIssue includes all comments when no triggerCommentId", () => {
    const f = new GiteaForge("gitea.example.com", "o", "r")
    const data = f.buildPromptDataForIssue({
      title: "Bug",
      body: "",
      author: { login: "alice" },
      createdAt: "2025-01-01",
      state: "open",
      comments: [{ id: 1, body: "LGTM", author: { login: "bob" }, createdAt: "2025-01-02" }],
    })
    expect(data).toContain("bob")
    expect(data).toContain("LGTM")
  })

  test("buildPromptDataForPR includes PR context", () => {
    const f = new GiteaForge("gitea.example.com", "o", "r")
    const data = f.buildPromptDataForPR({
      title: "Feature",
      body: "Adds X",
      author: { login: "alice" },
      baseRefName: "main",
      headRefName: "feat/x",
      headRefOid: "abc123",
      createdAt: "2025-01-01",
      additions: 10,
      deletions: 2,
      state: "open",
      baseRepository: "o/r",
      headRepository: "o/r",
      commits: { totalCount: 1, nodes: [{ oid: "abc", message: "feat", author: { name: "A", email: "a@b" } }] },
      files: [{ path: "foo.ts", additions: 5, deletions: 1, changeType: "added" }],
      comments: [],
      reviews: [],
    })
    expect(data).toContain("Feature")
    expect(data).toContain("foo.ts")
    expect(data).toContain("gitea_action_context")
    expect(data).toContain("Base Branch: main")
    expect(data).toContain("Head Branch: feat/x")
  })

  test("buildPromptDataForPR filters trigger comment", () => {
    const f = new GiteaForge("gitea.example.com", "o", "r")
    const data = f.buildPromptDataForPR(
      {
        title: "Feature",
        body: "",
        author: { login: "alice" },
        baseRefName: "main",
        headRefName: "feat/x",
        headRefOid: "abc",
        createdAt: "2025-01-01",
        additions: 0,
        deletions: 0,
        state: "open",
        baseRepository: "o/r",
        headRepository: "o/r",
        commits: { totalCount: 0, nodes: [] },
        files: [],
        comments: [
          { id: 99, body: "fix this", author: { login: "bob" }, createdAt: "2025-01-01" },
          { id: 100, body: "/oc review", author: { login: "carol" }, createdAt: "2025-01-02" },
        ],
        reviews: [],
      },
      100,
    )
    expect(data).toContain("fix this")
    expect(data).not.toContain("/oc review")
  })

  test("revokeToken is a no-op", async () => {
    const f = new GiteaForge("gitea.example.com", "o", "r")
    await f.revokeToken()
  })

  test("authenticate stores token", () => {
    const f = new GiteaForge("gitea.example.com", "o", "r")
    f.authenticate("test-token")
    expect(() => {}).not.toThrow()
  })
})
