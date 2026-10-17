import { expect, test } from "bun:test"
import { resolveSessionDirectory } from "./composer-adapter"

test("new local sessions retain the selected subdirectory inside a Git project", async () => {
  expect(
    await resolveSessionDirectory({
      currentDirectory: "/repo/knowledgebase",
      projectDirectory: "/repo",
      worktree: "main",
    } as Parameters<typeof resolveSessionDirectory>[0]),
  ).toBe("/repo/knowledgebase")
})
