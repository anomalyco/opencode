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

/**
 * Client-side mirror of the server's `project.directory.resolved` session fold.
 * Returns the ownership update for a cached session, or undefined when the
 * session does not follow the resolution. Plain strings: callers hold
 * generated client types, and the server projection remains authoritative.
 */
export function adopt(
  session: { readonly projectID: string; readonly directory: string },
  event: { readonly projectID: string; readonly directory: string; readonly previous: string },
) {
  if (session.projectID !== event.previous && session.projectID !== Project.ID.global) return
  if (session.projectID === event.projectID) return
  const inside =
    session.directory === event.directory ||
    session.directory.startsWith(event.directory + "/") ||
    session.directory.startsWith(event.directory + "\\")
  if (!inside) return
  return {
    projectID: event.projectID,
    subpath:
      session.directory === event.directory
        ? undefined
        : session.directory.slice(event.directory.length + 1).replaceAll("\\", "/"),
  }
}
