import { expect, test } from "bun:test"
import type { Project } from "@/runtime/server/types"
import { resolveStartProject } from "./start"

test("a chosen sibling clone keeps its directory with the canonical project's identity", () => {
  // SAFETY: the helper only reads the project's id and worktree, both supplied here.
  const canonical = { id: "proj_repo", worktree: "/srv/repo" } as Project
  const chosen = "/srv/repo-copy"

  // The real forDirectory returns undefined for a sibling clone; the saved selection carries the project id.
  expect(resolveStartProject(chosen, () => undefined, [canonical], undefined, canonical)).toEqual({
    directory: chosen,
    project: canonical,
  })
})

test("a canonical directory still resolves through the server's own lookup", () => {
  // SAFETY: the helper only reads the project's id and worktree, both supplied here.
  const canonical = { id: "proj_repo", worktree: "/srv/repo" } as Project

  expect(resolveStartProject(canonical.worktree, (directory) => (directory === canonical.worktree ? canonical : undefined), [canonical], undefined)).toEqual({
    directory: canonical.worktree,
    project: canonical,
  })
})
