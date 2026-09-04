import type { LocationGetOutput, OpenCodeClient } from "@opencode-ai/client/promise"
import type { Data } from "@opencode-ai/client/solid"

export async function createWorktree(input: {
  api: Pick<OpenCodeClient, "location" | "worktree">
  data: Pick<Data, "location">
  directory: string
  project?: LocationGetOutput["project"]
  branch?: string
}) {
  const project = input.project ?? (await input.api.location.get({ location: { directory: input.directory } })).project
  const created = await input.api.worktree.create({
    projectID: project.id,
    location: { directory: input.directory },
    branch: input.branch,
  })
  // Populate the client cache before the destination session mounts.
  await input.data.location.syncInfo({ directory: created.directory })
  return created.directory
}
