export * as ProjectDirectories from "./project-directories"

import { define } from "./event"
import { Project } from "./project"

export const Event = {
  Updated: define({
    type: "project.directories.updated",
    schema: { projectID: Project.ID },
  }),
}
export const ProjectDirectoriesEvent = Event
