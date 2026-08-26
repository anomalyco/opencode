import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Worktree } from "@opencode-ai/schema/worktree"

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
    expect(
      Worktree.adopt(
        { projectID: "directory-nested", directory: "c:/Repo/packages/App" },
        { ...event, directory: "C:\\repo" },
      ),
    ).toEqual({ projectID: "repository", subpath: "packages/App" })
  })

  test("normalizes aliases and rejects paths that leave the repository", () => {
    expect(Worktree.adopt({ projectID: "directory-nested", directory: "/repo/alias/../packages/app" }, event)).toEqual({
      projectID: "repository",
      subpath: "packages/app",
    })
    expect(Worktree.adopt({ projectID: "global", directory: "/repo/../other" }, event)).toBeUndefined()
    expect(Worktree.adopt({ projectID: "global", directory: "/app" }, { ...event, directory: "/" })).toEqual({
      projectID: "repository",
      subpath: "app",
    })
  })

  test("decodes existing durable events without adopted project IDs", () => {
    expect(
      Schema.decodeUnknownSync(Worktree.Event.Resolved.data)({
        projectID: "repository",
        directory: "/repo",
        previous: "global",
      }),
    ).toEqual({ projectID: "repository", directory: "/repo", previous: "global" })
  })
})
