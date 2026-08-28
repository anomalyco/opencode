import type { LocationGetOutput, OpenCodeClient } from "@opencode-ai/client/promise"
import { getDirectory } from "@opencode-ai/util/path"

export async function createWorktree(input: {
  api: Pick<OpenCodeClient, "location" | "worktree">
  directory: string
  project?: LocationGetOutput["project"]
  branch?: string
}) {
  const project = input.project ?? (await input.api.location.get({ location: { directory: input.directory } })).project
  const created = await input.api.worktree.create({
    projectID: project.id,
    strategy: "git",
    from: project.canonical,
    branch: input.branch,
    directory: getDirectory(project.canonical),
  })
  await input.api.location.get({ location: { directory: created.directory } })
  return created.directory
}
