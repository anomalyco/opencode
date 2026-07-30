import path from "path"
import { createMemo } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useToast } from "../ui/toast"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "../context/runtime"
import { errorMessage } from "../util/error"

export function DialogProject() {
  const dialog = useDialog()
  const data = useData()
  const route = useRoute()
  const toast = useToast()
  const paths = useTuiPaths()

  data.project.invalidate()
  void data.project.sync()
  const current = createMemo(() => data.location.info()?.project.id)
  const currentDirectory = createMemo(() => data.project.get(current() ?? "")?.canonical)

  const options = createMemo(() =>
    data.project
      .list()
      .filter((project) => project.canonical !== "/")
      .toSorted((a, b) => {
        if (a.id === current()) return -1
        if (b.id === current()) return 1
        return b.time.updated - a.time.updated
      })
      .filter((project, index, all) => all.findIndex((other) => other.canonical === project.canonical) === index)
      .map((project) => ({
        title: project.name ?? path.basename(project.canonical),
        description: abbreviateHome(project.canonical, paths.home),
        value: project.canonical,
        category: project.id === current() ? "Current" : "Projects",
      })),
  )

  return (
    <DialogSelect
      title="Switch project"
      placeholder="Search projects…"
      options={options()}
      current={currentDirectory()}
      emptyView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text>No projects found</text>
        </box>
      }
      onSelect={(option) => {
        dialog.clear()
        if (option.value === currentDirectory()) return
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
