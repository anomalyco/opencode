import { test, expect, describe } from "bun:test"
import { parseRemoteUrl, detectPlatform } from "../../src/git-platform/factory"

describe("parseRemoteUrl", () => {
  test("parses GitHub HTTPS URL with .git suffix", () => {
    const result = parseRemoteUrl("https://github.com/sst/opencode.git")
    expect(result).toEqual({
      platform: "github",
      baseUrl: "https://api.github.com",
      owner: "sst",
      repo: "opencode",
    })
  })

  test("parses GitHub HTTPS URL without .git suffix", () => {
    const result = parseRemoteUrl("https://github.com/sst/opencode")
    expect(result).toEqual({
      platform: "github",
      baseUrl: "https://api.github.com",
      owner: "sst",
      repo: "opencode",
    })
  })

  test("parses GitHub git@ URL", () => {
    const result = parseRemoteUrl("git@github.com:sst/opencode.git")
    expect(result).toEqual({
      platform: "github",
      baseUrl: "https://api.github.com",
      owner: "sst",
      repo: "opencode",
    })
  })

  test("parses GitHub SSH URL", () => {
    const result = parseRemoteUrl("ssh://git@github.com/sst/opencode.git")
    expect(result).toEqual({
      platform: "github",
      baseUrl: "https://api.github.com",
      owner: "sst",
      repo: "opencode",
    })
  })

  test("parses Codeberg URL as Forgejo", () => {
    const result = parseRemoteUrl("https://codeberg.org/user/repo.git")
    expect(result).toEqual({
      platform: "forgejo",
      baseUrl: "https://codeberg.org",
      owner: "user",
      repo: "repo",
    })
  })

  test("parses Codeberg git@ URL as Forgejo", () => {
    const result = parseRemoteUrl("git@codeberg.org:user/repo.git")
    expect(result).toEqual({
      platform: "forgejo",
      baseUrl: "https://codeberg.org",
      owner: "user",
      repo: "repo",
    })
  })

  test("parses gitea.com URL as Gitea", () => {
    const result = parseRemoteUrl("https://gitea.com/user/repo.git")
    expect(result).toEqual({
      platform: "gitea",
      baseUrl: "https://gitea.com",
      owner: "user",
      repo: "repo",
    })
  })

  test("parses self-hosted Gitea URL", () => {
    const result = parseRemoteUrl("https://git.example.com/org/project.git")
    expect(result).toEqual({
      platform: "gitea",
      baseUrl: "https://git.example.com",
      owner: "org",
      repo: "project",
    })
  })

  test("parses URL with gitea in hostname", () => {
    const result = parseRemoteUrl("https://gitea.mycompany.com/team/app.git")
    expect(result).toEqual({
      platform: "gitea",
      baseUrl: "https://gitea.mycompany.com",
      owner: "team",
      repo: "app",
    })
  })

  test("parses URL with forgejo in hostname", () => {
    const result = parseRemoteUrl("https://forgejo.example.org/dev/tools.git")
    expect(result).toEqual({
      platform: "forgejo",
      baseUrl: "https://forgejo.example.org",
      owner: "dev",
      repo: "tools",
    })
  })

  test("parses repos with dots in the name", () => {
    const result = parseRemoteUrl("https://codeberg.org/socketio/socket.io.git")
    expect(result).toEqual({
      platform: "forgejo",
      baseUrl: "https://codeberg.org",
      owner: "socketio",
      repo: "socket.io",
    })
  })

  test("parses repos with hyphens and underscores", () => {
    const result = parseRemoteUrl("https://gitea.com/my-org/my_repo.git")
    expect(result).toEqual({
      platform: "gitea",
      baseUrl: "https://gitea.com",
      owner: "my-org",
      repo: "my_repo",
    })
  })

  test("returns null for invalid URLs", () => {
    expect(parseRemoteUrl("not-a-url")).toBeNull()
    expect(parseRemoteUrl("")).toBeNull()
    expect(parseRemoteUrl("https://github.com/")).toBeNull()
  })
})

describe("detectPlatform", () => {
  test("returns github for github.com", async () => {
    const result = await detectPlatform("https://api.github.com")
    expect(result).toBe("github")
  })

  test("returns github for github URLs", async () => {
    const result = await detectPlatform("https://github.com")
    expect(result).toBe("github")
  })

  test("returns gitea for unknown hosts without version API", async () => {
    const result = await detectPlatform("https://nonexistent.invalid")
    expect(result).toBe("gitea")
  })
})
