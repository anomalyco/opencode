import type { Accessor } from "solid-js"
import { type CommandOption } from "@/context/command"
import type { LocalProject } from "@/context/layout"
import type { Locale } from "@/context/language"
import type { ColorScheme } from "@opencode-ai/ui/theme"

type ThemeEntry = {
  name?: string
}

type Input = {
  command: {
    register(key: string, cb: () => CommandOption[]): void
  }
  params: {
    dir?: string
    id?: string
  }
  language: {
    t: (key: string, args?: Record<string, string | number | boolean>) => string
    locales: readonly Locale[]
    label: (locale: Locale) => string
  }
  layout: {
    sidebar: {
      toggle: () => void
    }
  }
  currentProject: Accessor<LocalProject | undefined>
  workspaceSetting: Accessor<boolean>
  availableThemeEntries: Accessor<[string, ThemeEntry][]>
  colorSchemeOrder: readonly ColorScheme[]
  colorSchemeLabel: (scheme: ColorScheme) => string
  chooseProject: () => void | Promise<void>
  connectProvider: () => void
  openServer: () => void
  openSettings: () => void
  navigateSessionByOffset: (offset: number) => void
  navigateSessionByUnseen: (offset: number) => void
  archiveCurrentSession: () => void
  createCurrentWorkspace: () => void | Promise<void>
  toggleWorkspace: () => void
  cycleTheme: (direction?: number) => void
  cycleColorScheme: (direction?: number) => void
  cycleLanguage: (direction?: number) => void
  setLocale: (next: Locale) => void
  theme: {
    commitPreview: () => void
    previewTheme: (id: string) => void
    cancelPreview: () => void
    previewColorScheme: (scheme: ColorScheme) => void
  }
}

export function registerLayoutCommands(input: Input) {
  input.command.register("layout", () => {
    const list: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: input.language.t("command.sidebar.toggle"),
        category: input.language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: () => input.layout.sidebar.toggle(),
      },
      {
        id: "project.open",
        title: input.language.t("command.project.open"),
        category: input.language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => input.chooseProject(),
      },
      {
        id: "provider.connect",
        title: input.language.t("command.provider.connect"),
        category: input.language.t("command.category.provider"),
        onSelect: () => input.connectProvider(),
      },
      {
        id: "server.switch",
        title: input.language.t("command.server.switch"),
        category: input.language.t("command.category.server"),
        onSelect: () => input.openServer(),
      },
      {
        id: "settings.open",
        title: input.language.t("command.settings.open"),
        category: input.language.t("command.category.settings"),
        keybind: "mod+comma",
        onSelect: () => input.openSettings(),
      },
      {
        id: "session.previous",
        title: input.language.t("command.session.previous"),
        category: input.language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => input.navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: input.language.t("command.session.next"),
        category: input.language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => input.navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: input.language.t("command.session.previous.unseen"),
        category: input.language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => input.navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: input.language.t("command.session.next.unseen"),
        category: input.language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => input.navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: input.language.t("command.session.archive"),
        category: input.language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !input.params.dir || !input.params.id,
        onSelect: () => input.archiveCurrentSession(),
      },
      {
        id: "workspace.new",
        title: input.language.t("workspace.new"),
        category: input.language.t("command.category.workspace"),
        keybind: "mod+shift+w",
        disabled: !input.workspaceSetting(),
        onSelect: () => input.createCurrentWorkspace(),
      },
      {
        id: "workspace.toggle",
        title: input.language.t("command.workspace.toggle"),
        description: input.language.t("command.workspace.toggle.description"),
        category: input.language.t("command.category.workspace"),
        slash: "workspace",
        disabled: !input.currentProject() || input.currentProject()?.vcs !== "git",
        onSelect: () => input.toggleWorkspace(),
      },
      {
        id: "theme.cycle",
        title: input.language.t("command.theme.cycle"),
        category: input.language.t("command.category.theme"),
        keybind: "mod+shift+t",
        onSelect: () => input.cycleTheme(1),
      },
    ]

    for (const [id, item] of input.availableThemeEntries()) {
      list.push({
        id: `theme.set.${id}`,
        title: input.language.t("command.theme.set", { theme: item.name ?? id }),
        category: input.language.t("command.category.theme"),
        onSelect: () => input.theme.commitPreview(),
        onHighlight: () => {
          input.theme.previewTheme(id)
          return () => input.theme.cancelPreview()
        },
      })
    }

    list.push({
      id: "theme.scheme.cycle",
      title: input.language.t("command.theme.scheme.cycle"),
      category: input.language.t("command.category.theme"),
      keybind: "mod+shift+s",
      onSelect: () => input.cycleColorScheme(1),
    })

    for (const scheme of input.colorSchemeOrder) {
      list.push({
        id: `theme.scheme.${scheme}`,
        title: input.language.t("command.theme.scheme.set", { scheme: input.colorSchemeLabel(scheme) }),
        category: input.language.t("command.category.theme"),
        onSelect: () => input.theme.commitPreview(),
        onHighlight: () => {
          input.theme.previewColorScheme(scheme)
          return () => input.theme.cancelPreview()
        },
      })
    }

    list.push({
      id: "language.cycle",
      title: input.language.t("command.language.cycle"),
      category: input.language.t("command.category.language"),
      onSelect: () => input.cycleLanguage(1),
    })

    for (const locale of input.language.locales) {
      list.push({
        id: `language.set.${locale}`,
        title: input.language.t("command.language.set", { language: input.language.label(locale) }),
        category: input.language.t("command.category.language"),
        onSelect: () => input.setLocale(locale),
      })
    }

    return list
  })
}
