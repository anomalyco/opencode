import path from "path"
import { createMemo, createResource } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useToast } from "../ui/toast"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "../context/runtime"
import { errorMessage } from "../util/error"

export function DialogProject() {
  const dialog = useDialog()
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const toast = useToast()
  const paths = useTuiPaths()

  const [projects] = createResource(() => client.api.project.list())
  const current = createMemo(() => data.location.info()?.project.directory ?? data.location.default().directory)

  const options = createMemo(() => {
    const list = [...(projects() ?? [])]
    list.sort((a, b) => {
      if (a.worktree === current()) return -1
      if (b.worktree === current()) return 1
      return (b.time.initialized ?? 0) - (a.time.initialized ?? 0)
    })
    return list
      .filter((project) => project.worktree !== "/")
      .filter((project, index, all) => all.findIndex((other) => other.worktree === project.worktree) === index)
      .map((project) => ({
        title: project.name ?? path.basename(project.worktree),
        description: abbreviateHome(project.worktree, paths.home),
        value: project.worktree,
        category: project.worktree === current() ? "Current" : "Projects",
      }))
  })

  return (
    <DialogSelect
      title="Switch project"
      placeholder="Search projects…"
      options={options()}
      current={current()}
      emptyView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text>{projects.loading ? "Loading projects…" : "No projects found"}</text>
        </box>
      }
      onSelect={(option) => {
        dialog.clear()
        if (option.value === current()) return
        // Navigating while already home would remount the footer mid-animation.
        if (route.data.type !== "home") route.navigate({ type: "home" })
        void data.location
          .setDefault(option.value)
          .catch((error) =>
            toast.show({ variant: "error", title: "Failed to switch project", message: errorMessage(error) }),
          )
      }}
    />
  )
}
