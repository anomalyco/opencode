import type { ServerCtx } from "@/runtime/server/runtime"

export function addProjects(context: ServerCtx, directories: string[]) {
  const directory = directories[0]
  if (!directory) return

  directories.forEach((item) => {
    // Compare against opened projects only: list() also contains server-known entries,
    // and an explicit add must still persist the directory so it is no longer appended-only.
    if (context.projects.opened().some((project) => project.worktree === item)) return
    const location = { directory: item }
    void context.sdk.api.file
      .list({ path: ".", location })
      .then(() => context.sdk.api.location.get({ location }))
      .then((value) => context.sync.child(item, { bootstrap: false })[1]("project", value.project.id))
      .catch(() => undefined)
    context.projects.open(item)
  })
  context.projects.touch(directory)
  return directory
}
