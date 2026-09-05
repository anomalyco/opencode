import { test, expect, describe } from "bun:test"
import { parseGitHubRemote, parseGitRemote } from "../../src/cli/cmd/github"

test("parses https URL with .git suffix", () => {
  expect(parseGitHubRemote("https://github.com/sst/opencode.git")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses https URL without .git suffix", () => {
  expect(parseGitHubRemote("https://github.com/sst/opencode")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses git@ URL with .git suffix", () => {
  expect(parseGitHubRemote("git@github.com:sst/opencode.git")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses git@ URL without .git suffix", () => {
  expect(parseGitHubRemote("git@github.com:sst/opencode")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses ssh:// URL with .git suffix", () => {
  expect(parseGitHubRemote("ssh://git@github.com/sst/opencode.git")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses ssh:// URL without .git suffix", () => {
  expect(parseGitHubRemote("ssh://git@github.com/sst/opencode")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses git protocol URLs from package metadata", () => {
  expect(parseGitHubRemote("git://github.com/facebook/react.git")).toEqual({ owner: "facebook", repo: "react" })
  expect(parseGitHubRemote("git+https://github.com/facebook/react.git")).toEqual({ owner: "facebook", repo: "react" })
  expect(parseGitHubRemote("git+ssh://git@github.com/facebook/react.git")).toEqual({ owner: "facebook", repo: "react" })
})

test("parses npm-style github shorthand", () => {
  expect(parseGitHubRemote("github:facebook/react")).toBeNull()
})

test("parses http URL", () => {
  expect(parseGitHubRemote("http://github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" })
})

test("parses URL with hyphenated owner and repo names", () => {
  expect(parseGitHubRemote("https://github.com/my-org/my-repo.git")).toEqual({ owner: "my-org", repo: "my-repo" })
})

test("parses URL with underscores in names", () => {
  expect(parseGitHubRemote("git@github.com:my_org/my_repo.git")).toEqual({ owner: "my_org", repo: "my_repo" })
})

test("parses URL with numbers in names", () => {
  expect(parseGitHubRemote("https://github.com/org123/repo456")).toEqual({ owner: "org123", repo: "repo456" })
})

test("parses repos with dots in the name", () => {
  expect(parseGitHubRemote("https://github.com/socketio/socket.io.git")).toEqual({
    owner: "socketio",
    repo: "socket.io",
  })
  expect(parseGitHubRemote("https://github.com/vuejs/vue.js")).toEqual({
    owner: "vuejs",
    repo: "vue.js",
  })
  expect(parseGitHubRemote("git@github.com:mrdoob/three.js.git")).toEqual({
    owner: "mrdoob",
    repo: "three.js",
  })
  expect(parseGitHubRemote("https://github.com/jashkenas/backbone.git")).toEqual({
    owner: "jashkenas",
    repo: "backbone",
  })
})

test("returns null for non-github URLs", () => {
  expect(parseGitHubRemote("https://gitlab.com/owner/repo.git")).toBeNull()
  expect(parseGitHubRemote("git@gitlab.com:owner/repo.git")).toBeNull()
  expect(parseGitHubRemote("https://bitbucket.org/owner/repo")).toBeNull()
})

test("returns null for invalid URLs", () => {
  expect(parseGitHubRemote("not-a-url")).toBeNull()
  expect(parseGitHubRemote("")).toBeNull()
  expect(parseGitHubRemote("github.com")).toBeNull()
  expect(parseGitHubRemote("https://github.com/")).toBeNull()
  expect(parseGitHubRemote("https://github.com/owner")).toBeNull()
})

test("returns null for URLs with extra path segments", () => {
  expect(parseGitHubRemote("https://github.com/owner/repo/tree/main")).toBeNull()
  expect(parseGitHubRemote("https://github.com/owner/repo/blob/main/file.ts")).toBeNull()
})

// parseGitRemote tests - matches any host for GHES support
describe("parseGitRemote", () => {
  test("parses github.com https URL", () => {
    expect(parseGitRemote("https://github.com/sst/opencode.git")).toEqual({
      host: "github.com",
      owner: "sst",
      repo: "opencode",
    })
  })

  test("parses github.com git@ URL", () => {
    expect(parseGitRemote("git@github.com:sst/opencode.git")).toEqual({
      host: "github.com",
      owner: "sst",
      repo: "opencode",
    })
  })

  test("parses GHES https URL", () => {
    expect(parseGitRemote("https://github.example.com/my-org/my-repo.git")).toEqual({
      host: "github.example.com",
      owner: "my-org",
      repo: "my-repo",
    })
  })

  test("parses GHES git@ URL", () => {
    expect(parseGitRemote("git@github.example.com:my-org/my-repo.git")).toEqual({
      host: "github.example.com",
      owner: "my-org",
      repo: "my-repo",
    })
  })

  test("parses GHES ssh:// URL", () => {
    expect(parseGitRemote("ssh://git@github.example.com/my-org/my-repo.git")).toEqual({
      host: "github.example.com",
      owner: "my-org",
      repo: "my-repo",
    })
  })

  test("parses GHES URL without .git suffix", () => {
    expect(parseGitRemote("https://ghes.company.org/team/project")).toEqual({
      host: "ghes.company.org",
      owner: "team",
      repo: "project",
    })
  })

  test("parses gitlab URLs", () => {
    expect(parseGitRemote("https://gitlab.com/owner/repo.git")).toEqual({
      host: "gitlab.com",
      owner: "owner",
      repo: "repo",
    })
  })

  test("returns null for invalid URLs", () => {
    expect(parseGitRemote("not-a-url")).toBeNull()
    expect(parseGitRemote("")).toBeNull()
    expect(parseGitRemote("https://github.com/")).toBeNull()
    expect(parseGitRemote("https://github.com/owner")).toBeNull()
  })

  test("returns null for URLs with extra path segments", () => {
    expect(parseGitRemote("https://github.com/owner/repo/tree/main")).toBeNull()
  })

  test("parses repos with dots in the name", () => {
    expect(parseGitRemote("https://github.example.com/socketio/socket.io.git")).toEqual({
      host: "github.example.com",
      owner: "socketio",
      repo: "socket.io",
    })
  })
})
