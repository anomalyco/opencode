export * as ProjectDirectories from "./project-directories.js"

import { ephemeral, inventory } from "./event.js"
import { Project } from "./project.js"

const Updated = ephemeral({
  type: "project.directories.updated",
  schema: { projectID: Project.ID },
})
export const Event = { Updated, Definitions: inventory(Updated) }
