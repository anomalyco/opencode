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

export function DialogProject() {
  const dialog = useDialog()
  const data = useData()
  const route = useRoute()
  const paths = useTuiPaths()
  const location = useLocation()
  const toast = useToast()

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
      .map((project) => ({
        title: project.name ?? path.basename(project.canonical),
        description: abbreviateHome(project.canonical, paths.home),
        value: project.canonical,
        category: project.id === current()?.id ? "Current" : "Projects",
      }))
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
