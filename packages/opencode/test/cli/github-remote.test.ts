import { test, expect } from "bun:test"
import { parseGitHubRemote } from "../../src/cli/cmd/github"

test("parses https URL with .git suffix", async () => {
  expect(await parseGitHubRemote("https://github.com/sst/opencode.git")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses https URL without .git suffix", async () => {
  expect(await parseGitHubRemote("https://github.com/sst/opencode")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses git@ URL with .git suffix", async () => {
  expect(await parseGitHubRemote("git@github.com:sst/opencode.git")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses git@ URL without .git suffix", async () => {
  expect(await parseGitHubRemote("git@github.com:sst/opencode")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses ssh:// URL with .git suffix", async () => {
  expect(await parseGitHubRemote("ssh://git@github.com/sst/opencode.git")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses ssh:// URL without .git suffix", async () => {
  expect(await parseGitHubRemote("ssh://git@github.com/sst/opencode")).toEqual({ owner: "sst", repo: "opencode" })
})

test("parses http URL", async () => {
  expect(await parseGitHubRemote("http://github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" })
})

test("parses URL with hyphenated owner and repo names", async () => {
  expect(await parseGitHubRemote("https://github.com/my-org/my-repo.git")).toEqual({ owner: "my-org", repo: "my-repo" })
})

test("parses URL with underscores in names", async () => {
  expect(await parseGitHubRemote("git@github.com:my_org/my_repo.git")).toEqual({ owner: "my_org", repo: "my_repo" })
})

test("parses URL with numbers in names", async () => {
  expect(await parseGitHubRemote("https://github.com/org123/repo456")).toEqual({ owner: "org123", repo: "repo456" })
})

test("parses repos with dots in the name", async () => {
  expect(await parseGitHubRemote("https://github.com/socketio/socket.io.git")).toEqual({
    owner: "socketio",
    repo: "socket.io",
  })
  expect(await parseGitHubRemote("https://github.com/vuejs/vue.js")).toEqual({
    owner: "vuejs",
    repo: "vue.js",
  })
  expect(await parseGitHubRemote("git@github.com:mrdoob/three.js.git")).toEqual({
    owner: "mrdoob",
    repo: "three.js",
  })
  expect(await parseGitHubRemote("https://github.com/jashkenas/backbone.git")).toEqual({
    owner: "jashkenas",
    repo: "backbone",
  })
})

test("returns null for non-github URLs", async () => {
  expect(await parseGitHubRemote("https://gitlab.com/owner/repo.git")).toBeNull()
  expect(await parseGitHubRemote("git@gitlab.com:owner/repo.git")).toBeNull()
  expect(await parseGitHubRemote("https://bitbucket.org/owner/repo")).toBeNull()
})

test("returns null for invalid URLs", async () => {
  expect(await parseGitHubRemote("not-a-url")).toBeNull()
  expect(await parseGitHubRemote("")).toBeNull()
  expect(await parseGitHubRemote("github.com")).toBeNull()
  expect(await parseGitHubRemote("https://github.com/")).toBeNull()
  expect(await parseGitHubRemote("https://github.com/owner")).toBeNull()
})

test("returns null for URLs with extra path segments", async () => {
  expect(await parseGitHubRemote("https://github.com/owner/repo/tree/main")).toBeNull()
  expect(await parseGitHubRemote("https://github.com/owner/repo/blob/main/file.ts")).toBeNull()
})
