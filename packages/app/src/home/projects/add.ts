import type { ServerCtx } from "@/runtime/server/runtime"

export function addProjects(context: ServerCtx, directories: string[]) {
  const directory = directories[0]

  if (!directory) return

  directories.forEach((item) => {
    // A discovered project is listed but not opened here; adding it explicitly still opens it.
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
