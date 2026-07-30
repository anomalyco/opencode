import path from "path"
import { createMemo } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "../context/runtime"
import { useLocation } from "../context/location"
import { useToast } from "../ui/toast"
import { useTerminalDimensions } from "@opentui/solid"
import { truncateFilePath } from "../ui/file-path"
import { stringWidth } from "../util/string-width"

export function DialogProject() {
  const dialog = useDialog()
  const data = useData()
  const route = useRoute()
  const paths = useTuiPaths()
  const location = useLocation()
  const toast = useToast()
  const dimensions = useTerminalDimensions()

  data.project.invalidate()
  void data.project.sync().catch(toast.error)

  const current = () => location.current?.project

  const options = createMemo(() => {
    const seen = new Set<string>()
    return data.project
      .list()
      .filter((project) => {
        if (project.canonical === "/" || seen.has(project.canonical)) return false
        seen.add(project.canonical)
        return true
      })
      .toSorted((a, b) => {
        if (a.id === current()?.id) return -1
        if (b.id === current()?.id) return 1
        return 0
      })
      .map((project) => {
        const title = project.name ?? path.basename(project.canonical)
        const description = abbreviateHome(project.canonical, paths.home)
        // Dialog padding, the current marker, title padding, and the separating space use nine columns.
        const width = Math.min(60, dimensions().width - 2) - 9 - stringWidth(title)
        return {
          title,
          description: truncateFilePath(description, width),
          searchText: description,
          value: project.canonical,
        }
      })
  })

  return (
    <DialogSelect
      title="Switch project"
      placeholder="Search projects…"
      options={options()}
      current={current()?.canonical}
      emptyView={
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text>No projects found</text>
        </box>
      }
      onSelect={(option) => {
        dialog.clear()
        if (option.value === current()?.canonical) return
        const target = { directory: option.value }
        route.navigate({ type: "home", location: target })
        location.set(target)
      }}
    />
  )
}
