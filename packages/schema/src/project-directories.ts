export * as ProjectDirectories from "./project-directories.js"

import { define, inventory } from "./event.js"
import { Project } from "./project.js"

const Updated = define({
  type: "project.directories.updated",
  schema: { projectID: Project.ID },
})
export const Event = { Updated, Definitions: inventory(Updated) }
