import { expect, test } from "bun:test"
import type { Project } from "@/runtime/server/types"
import { resolveStartProject } from "./start"

test("a chosen sibling clone keeps its directory with the canonical project's identity", () => {
  // SAFETY: the helper only reads the project's id and worktree, both supplied here.
  const canonical = { id: "proj_repo", worktree: "/srv/repo" } as Project
  const chosen = "/srv/repo-copy"

  expect(resolveStartProject(chosen, () => canonical, [canonical], undefined)).toEqual({
    directory: chosen,
    project: canonical,
  })
})
