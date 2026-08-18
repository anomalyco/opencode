import { useCommand } from "@/context/command"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { ServerConnection, useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { useTabs } from "@/context/tabs"
import { useDirectoryPicker } from "@/components/directory-picker"
import { openServerProjects, useGlobal } from "@/context/global"
import { usePlatform } from "@/context/platform"

/**
 * Registers fallback command handlers for desktop menu items that may not be
 * registered on certain pages (e.g. the home page in the new layout).
 *
 * The command registry gives the most recent keyed registration precedence.
 * When the session page mounts, its registration replaces the session
 * fallback without producing duplicate command IDs. The layout fallback owns
 * commands that the new shell no longer registers.
 *
 * When the session page unmounts (e.g. navigating back to home), its
 * registration is cleaned up via `onCleanup`, and this fallback automatically
 * becomes active again.
 */
export function useMenuFallbackCommands() {
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()
  const settings = useSettings()
  const platform = usePlatform()
  const server = useServer()
  const global = useGlobal()
  const tabs = useTabs()
  const pickDirectory = useDirectoryPicker()

  if (platform.platform !== "desktop" || !settings.general.newLayoutDesigns()) return null

  command.register("session", () => [
    {
      id: "session.new",
      title: language.t("command.session.new"),
      category: language.t("command.category.session"),
      keybind: "mod+shift+s",
      onSelect: () => {
        const hasTabNew = command.options.some((opt) => opt.id === "tab.new")
        if (hasTabNew) command.trigger("tab.new")
      },
    },
    {
      id: "terminal.toggle",
      title: language.t("command.terminal.toggle"),
      category: language.t("command.category.view"),
      keybind: "ctrl+`",
      onSelect: () => layout.terminal.toggle(),
    },
    {
      id: "fileTree.toggle",
      title: language.t("command.fileTree.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+\\",
      onSelect: () => layout.fileTree.toggle(),
    },
  ])

  command.register("layout", () => [
    {
      id: "project.open",
      title: language.t("command.project.open"),
      category: language.t("command.category.project"),
      keybind: "mod+o",
      onSelect: () => {
        const conn = server.current
        if (!conn) return
        pickDirectory({
          server: conn,
          title: language.t("command.project.open"),
          multiple: true,
          onSelect: (result) => {
            if (!result) return
            const dirs = Array.isArray(result) ? result : [result]
            const directory = openServerProjects(global.ensureServerCtx(conn), dirs)
            if (!directory) return
            void tabs.newDraft({ server: ServerConnection.key(conn), directory })
          },
        })
      },
    },
    {
      id: "sidebar.toggle",
      title: language.t("command.sidebar.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+b",
      onSelect: () => layout.sidebar.toggle(),
    },
  ])

  return null
}
