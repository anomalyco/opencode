import { describe, expect, test } from "bun:test"
import {
  cloneRepositoryName,
  isGitRepositoryUrl,
  nextProjectOpenMode,
  parseProjectInput,
  projectOpenError,
  resolveCloneRepositoryUrl,
  suggestCloneTargetPath,
} from "./dialog-open-project.helpers"

describe("dialog-open-project helpers", () => {
  test("trims project input", () => {
    expect(parseProjectInput("  ~/code/foo  ")).toBe("~/code/foo")
  })

  test("validates supported git url formats", () => {
    expect(isGitRepositoryUrl("https://github.com/anomalyco/opencode.git")).toBeTrue()
    expect(isGitRepositoryUrl("ssh://git@github.com/anomalyco/opencode.git")).toBeTrue()
    expect(isGitRepositoryUrl("git@github.com:anomalyco/opencode.git")).toBeTrue()
    expect(isGitRepositoryUrl("~/code/opencode")).toBeFalse()
  })

  test("switches mode between git and path", () => {
    expect(nextProjectOpenMode("git")).toBe("path")
    expect(nextProjectOpenMode("path")).toBe("git")
  })

  test("normalizes unknown errors", () => {
    expect(projectOpenError(new Error("boom"))).toBe("boom")
    expect(projectOpenError("broken")).toBe("broken")
    expect(projectOpenError(null)).toBe("Unknown error")
  })

  test("resolves clone urls for github and gitlab", () => {
    expect(resolveCloneRepositoryUrl("anomalyco/opencode")).toBe("https://github.com/anomalyco/opencode.git")
    expect(resolveCloneRepositoryUrl("gitlab.com/group/subgroup/project")).toBe(
      "https://gitlab.com/group/subgroup/project.git",
    )
    expect(resolveCloneRepositoryUrl("gitlab:group/project")).toBe("https://gitlab.com/group/project.git")
    expect(resolveCloneRepositoryUrl("github:anomalyco/opencode")).toBe("https://github.com/anomalyco/opencode.git")
  })

  test("extracts repository name for clone target", () => {
    expect(cloneRepositoryName("https://github.com/Infatoshi/magic.rs")).toBe("magic.rs")
    expect(cloneRepositoryName("gitlab.com/group/subgroup/project")).toBe("project")
    expect(cloneRepositoryName("invalid input")).toBe("")
  })

  test("suggests clone path from root and repository", () => {
    expect(suggestCloneTargetPath("https://github.com/Infatoshi/magic.rs", "/Users/me/Documents/code")).toBe(
      "/Users/me/Documents/code/magic.rs",
    )
    expect(suggestCloneTargetPath("", "/Users/me/Documents/code")).toBe("/Users/me/Documents/code")
  })
})
