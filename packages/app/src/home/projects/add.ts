import type { ServerCtx } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import type { HomeProjectSelection } from "@/shell/state/layout"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { useDirectoryPicker } from "@/workspaces/selection/picker"

export function createProjectAdder(
  context: (conn: ServerConnection.Any) => ServerCtx,
  select: (selection: HomeProjectSelection) => void,
) {
  return (conn: ServerConnection.Any, directories: string[]) => {
    const directory = addProjects(context(conn), directories)

    if (!directory) return
    select({ server: ServerConnection.key(conn), directory })
  }
}

export function useProjectPicker(add: (conn: ServerConnection.Any, directories: string[]) => void) {
  const pickDirectory = useDirectoryPicker()
  const language = useLanguage()

  return (conn: ServerConnection.Any) =>
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => add(conn, homeProjectDirectories(result)),
    })
}

export function addProjects(context: ServerCtx, directories: string[]) {
  const directory = directories[0]

  if (!directory) return

  directories.forEach((item) => {
    if (context.projects.list().some((project) => project.worktree === item)) return
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
