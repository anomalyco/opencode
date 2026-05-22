import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Global } from "@opencode-ai/core/global"
import {
  isFileRepositoryReference,
  isRemoteRepositoryReference,
  parseRemoteRepositoryReference,
  parseRepositoryReference,
  repositoryCacheIdentity,
  repositoryCachePath,
  sameRepositoryReference,
  validateRepositoryBranch,
} from "../../src/util/repository"

describe("util.repository", () => {
  test("parses github shorthand and preserves cache path", () => {
    const reference = parseRemoteRepositoryReference("owner/repo")

    expect(reference).toMatchObject({
      host: "github.com",
      path: "owner/repo",
      segments: ["owner", "repo"],
      owner: "owner",
      repo: "repo",
      label: "owner/repo",
    })
    expect(repositoryCachePath(reference)).toBe(path.join(Global.Path.repos, "github.com", "owner", "repo"))
    expect(repositoryCacheIdentity(reference)).toBe("github.com/owner/repo")
  })

  test("parses host path and scp remote references", () => {
    const hostPath = parseRemoteRepositoryReference("gitlab.com/group/repo")
    const scp = parseRemoteRepositoryReference("git@github.com:owner/repo.git")

    expect(hostPath).toMatchObject({
      host: "gitlab.com",
      path: "group/repo",
      remote: "https://gitlab.com/group/repo.git",
      label: "gitlab.com/group/repo",
    })
    expect(scp).toMatchObject({
      host: "github.com",
      path: "owner/repo",
      remote: "git@github.com:owner/repo.git",
      label: "owner/repo",
    })
  })

  test("keeps local file repositories distinct from remote repositories", () => {
    const localPath = path.resolve("repo.git")
    const reference = parseRepositoryReference(pathToFileURL(localPath).href)

    expect(reference).toMatchObject({
      host: "file",
      protocol: "file:",
      label: localPath,
    })
    expect(reference && isFileRepositoryReference(reference)).toBe(true)
    expect(reference && isRemoteRepositoryReference(reference)).toBe(false)
    expect(() => parseRemoteRepositoryReference(pathToFileURL(localPath).href)).toThrow(
      "Local file repositories are not supported",
    )
  })

  test("compares cache identity independent of input spelling", () => {
    const shorthand = parseRemoteRepositoryReference("owner/repo")
    const url = parseRemoteRepositoryReference("https://github.com/owner/repo.git")
    const hostPath = parseRemoteRepositoryReference("github.com/owner/repo")

    expect(sameRepositoryReference(shorthand, url)).toBe(true)
    expect(sameRepositoryReference(shorthand, hostPath)).toBe(true)
  })

  test("validates repository branch names", () => {
    expect(() => validateRepositoryBranch("feature/docs.v1")).not.toThrow()
    expect(() => validateRepositoryBranch("-bad")).toThrow("Branch must contain only alphanumeric characters")
    expect(() => validateRepositoryBranch("bad..branch")).toThrow("Branch must contain only alphanumeric characters")
    expect(() => validateRepositoryBranch("bad branch")).toThrow("Branch must contain only alphanumeric characters")
  })
})
