import { createMemo } from "solid-js"
import { Match } from "effect"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { createProjectAdder, useProjectPicker } from "@/home/projects/add"
import { useCommand } from "./command"

export function ProjectCommands() {
  const command = useCommand()
  const language = useLanguage()
  const global = useGlobal()
  const servers = useServers()
  const layout = useLayout()
  const tabs = useTabs()
  const navigate = useNavigate()

  const choose = useProjectPicker(
    createProjectAdder(
      (conn) => global.ensureServerCtx(conn),
      (selection) => {
        layout.home.setSelection(selection)
        navigate("/")
      },
    ),
  )

  const connection = createMemo(() => {
    const route = layout.route()

    const key = Match.value(route).pipe(
      Match.when({ type: "session" }, (route) => route.server),
      Match.when(
        { type: "draft" },
        (route) => tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)?.server,
      ),
      Match.orElse(() => layout.home.selection().server),
    )

    return servers.list.find((conn) => ServerConnection.key(conn) === key) ?? servers.visible[0]
  })

  command.register("project", () => [
    {
      id: "project.open",
      title: language.t("command.project.open"),
      category: language.t("command.category.file"),
      keybind: "mod+o",
      disabled: !connection(),
      onSelect: () => {
        const conn = connection()

        if (!conn) return
        choose(conn)
      },
    },
  ])

  return null
}
