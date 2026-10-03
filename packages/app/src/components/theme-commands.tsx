import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { showToast } from "@/utils/toast"

export function ThemeCommands() {
  const command = useCommand()
  const theme = useTheme()
  const language = useLanguage()
  const settings = useSettings()
  const schemes: ColorScheme[] = ["system", "light", "dark"]
  const labels = {
    system: "theme.scheme.system",
    light: "theme.scheme.light",
    dark: "theme.scheme.dark",
  } as const

  command.register("theme", () => [
    {
      id: "theme.cycle",
      title: language.t("command.theme.cycle"),
      category: language.t("command.category.theme"),
      // The new layout uses this shortcut to reopen a closed tab.
      keybind: settings.general.newLayoutDesigns() ? undefined : "mod+shift+t",
      onSelect: () => {
        const ids = theme.ids()
        if (ids.length === 0) return
        const next = ids[(ids.indexOf(theme.themeId()) + 1) % ids.length]
        theme.setTheme(next)
        showToast({
          title: language.t("toast.theme.title"),
          description: theme.name(next),
        })
      },
    },
    ...theme.ids().map((id) => ({
      id: `theme.set.${id}`,
      title: language.t("command.theme.set", { theme: theme.name(id) }),
      category: language.t("command.category.theme"),
      onSelect: () => theme.commitPreview(),
      onHighlight: () => {
        theme.previewTheme(id)
        return () => theme.cancelPreview()
      },
    })),
    {
      id: "theme.scheme.cycle",
      title: language.t("command.theme.scheme.cycle"),
      category: language.t("command.category.theme"),
      // The new layout keeps this shortcut for starting a new session.
      keybind: settings.general.newLayoutDesigns() ? undefined : "mod+shift+s",
      onSelect: () => {
        const next = schemes[(schemes.indexOf(theme.colorScheme()) + 1) % schemes.length]
        theme.setColorScheme(next)
        showToast({
          title: language.t("toast.scheme.title"),
          description: language.t(labels[next]),
        })
      },
    },
    ...schemes.map((scheme) => ({
      id: `theme.scheme.${scheme}`,
      title: language.t("command.theme.scheme.set", { scheme: language.t(labels[scheme]) }),
      category: language.t("command.category.theme"),
      onSelect: () => theme.commitPreview(),
      onHighlight: () => {
        theme.previewColorScheme(scheme)
        return () => theme.cancelPreview()
      },
    })),
  ])

  return null
}
