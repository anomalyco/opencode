import { describe, expect, test } from "bun:test"
import { Worktree } from "../src/worktree.js"

describe("Worktree.adopt", () => {
  const event = {
    projectID: "repository",
    directory: "/repo",
    previous: "previous",
    adopted: ["directory-root", "directory-nested"],
  }

  test("adopts explicitly superseded directory projects", () => {
    expect(Worktree.adopt({ projectID: "directory-root", directory: "/repo" }, event)).toEqual({
      projectID: "repository",
      subpath: undefined,
    })
    expect(Worktree.adopt({ projectID: "directory-nested", directory: "/repo/packages/app" }, event)).toEqual({
      projectID: "repository",
      subpath: "packages/app",
    })
  })

  test("preserves existing previous-project and global adoption", () => {
    expect(Worktree.adopt({ projectID: "previous", directory: "/repo/packages/app" }, event)).toEqual({
      projectID: "repository",
      subpath: "packages/app",
    })
    expect(Worktree.adopt({ projectID: "global", directory: "/repo/packages/app" }, event)).toEqual({
      projectID: "repository",
      subpath: "packages/app",
    })
  })

  test("leaves unrelated projects, sibling directories, and workspaces unchanged", () => {
    expect(Worktree.adopt({ projectID: "other", directory: "/repo/vendor" }, event)).toBeUndefined()
    expect(Worktree.adopt({ projectID: "global", directory: "/repo-other" }, event)).toBeUndefined()
    expect(Worktree.adopt({ projectID: "repository", directory: "/repo" }, event)).toBeUndefined()
    expect(
      Worktree.adopt({ projectID: "directory-root", directory: "/repo", workspaceID: "remote" }, event),
    ).toBeUndefined()
  })

  test("normalizes Windows directory separators", () => {
    expect(
      Worktree.adopt(
        { projectID: "directory-nested", directory: "C:\\repo\\packages\\app" },
        { ...event, directory: "C:\\repo" },
      ),
    ).toEqual({ projectID: "repository", subpath: "packages/app" })
  })
})
