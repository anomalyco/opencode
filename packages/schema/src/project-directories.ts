export * as ProjectDirectories from "./project-directories.js"

import { durable, ephemeral, inventory } from "./event.js"
import { AbsolutePath } from "./schema.js"
import { Project } from "./project.js"

const Updated = ephemeral({
  type: "project.directories.updated",
  schema: { projectID: Project.ID },
})

/**
 * A directory's resolution changed: it now resolves to `projectID` where it
 * previously resolved to `previous` (`global` when the directory had no
 * stable identity yet, e.g. before `git init`). Sessions whose ownership
 * came from the previous resolution follow the new identity by projection.
 */
const Resolved = durable({
  type: "project.directory.resolved",
  durable: { aggregate: "projectID", version: 1 },
  schema: {
    projectID: Project.ID,
    directory: AbsolutePath,
    previous: Project.ID,
  },
})
export const Event = { Updated, Resolved, Definitions: inventory(Updated, Resolved) }
