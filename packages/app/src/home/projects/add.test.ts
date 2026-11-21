import { expect, test } from "bun:test"
import type { ServerCtx } from "@/runtime/server/runtime"
import { addProjects } from "./add"

test("adding a sibling clone keeps the chosen directory with the server's project identity", async () => {
  const touched: string[] = []

  // SAFETY: addProjects only calls projects.add and projects.touch, both mocked here.
  const context = {
    projects: {
      add: async () => ({ id: "proj_repo", worktree: "/srv/repo" }),
      touch: (directory: string) => touched.push(directory),
    },
  } as unknown as ServerCtx

  const project = await addProjects(context, ["/srv/repo-copy"])

  expect(project?.id).toBe("proj_repo")
  expect(project?.worktree).toBe("/srv/repo-copy")
  expect(touched).toEqual(["/srv/repo-copy"])
})
