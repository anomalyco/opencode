import type { Setting } from "@opencode/gui-extensions/sdk"
import type { useLanguage } from "@/runtime/i18n/language"
import type { LocalProject } from "@/shell/state/layout"
import { displayName } from "@opencode/ui/project-avatar"
import { clientSettings, projectSettings, serverSettings } from "./search-catalog"
import { pageIcons, pageLabels } from "./pages"
import type { SettingsSearchResult } from "./search-results"
import type { SettingsExtensionTab, SettingsHostView, SettingsServerTab, SettingsView } from "./surface"

export type SettingsSearchServer = {
  key: string
  name: string
  connected: boolean
  projects: readonly LocalProject[]
}

/** An extension setting that applies to this platform. */
export type SettingsSearchExtension = { extension: string; value: Setting }

export function settingsSearchIndex(input: {
  servers: readonly SettingsSearchServer[]
  desktop: boolean
  browser: boolean
  mobile: boolean
  translate: ReturnType<typeof useLanguage>["t"]
  extensions?: readonly SettingsSearchExtension[]
}) {
  const items: SettingsSearchResult[] = []
  const add = (
    entry: (typeof clientSettings)[number],
    view: SettingsHostView,
    owner: string,
    server?: string,
    project?: string,
    projectName?: string,
  ) => {
    const page =
      !server && view.tab === "general" && view.target
        ? `${input.translate(pageLabels.general)} / ${input.translate(entry.section ?? "settings.general.section.general")}`
        : input.translate(
            entry.section ??
              (view.type !== "root" && view.tab === "general"
                ? "settings.general.section.general"
                : pageLabels[view.tab]),
          )
    items.push({
      id: JSON.stringify([server, project, view.tab, view.target, view.subtab, entry.label]),
      title: input.translate(entry.label),
      description: entry.description ? input.translate(entry.description) : "",
      keywords: entry.keywords ?? "",
      owner,
      page,
      server,
      project,
      projectName,
      topLevel: !view.target && !view.subtab && !project,
      icon: pageIcons[view.tab],
      view,
    })
  }
  const extensions = input.extensions ?? []
  // Extension entries are keyed by extension and entry id; their copy is already translated.
  const addExtension = (
    item: SettingsSearchExtension,
    entry: NonNullable<Setting["entries"]>[number],
    view: SettingsView,
    page: string,
    owner: string,
    server?: string,
  ) =>
    items.push({
      id: JSON.stringify([server, undefined, view.tab, view.target, undefined, `${item.extension}:${entry.id}`]),
      title: entry.title,
      description: entry.description ?? "",
      keywords: entry.keywords ?? "",
      owner,
      page,
      server,
      topLevel: !view.target,
      icon: item.value.icon ?? pageIcons.extensions,
      view,
    })

  clientSettings.forEach((entry) => {
    if (entry.available === "desktop" && !input.desktop) return
    if (entry.available === "browser" && !input.browser) return
    if (entry.available === "mobile" && !input.mobile) return
    add(entry, { type: "root", tab: entry.tab, target: entry.target }, "")
  })
  extensions.forEach((item) => {
    const setting = item.value
    if (setting.page === "servers") return
    if (setting.page === "general")
      return setting.entries?.forEach((entry) =>
        addExtension(
          item,
          entry,
          { type: "root", tab: "general", target: entry.id },
          `${input.translate(pageLabels.general)} / ${setting.title}`,
          "",
        ),
      )
    const tab = setting.id as SettingsExtensionTab
    const page = setting.entries?.find((entry) => entry.id === setting.id)
    addExtension(item, { ...page, id: setting.id, title: setting.title }, { type: "root", tab }, setting.title, "")
    setting.entries?.forEach((entry) => {
      if (entry.id === setting.id) return
      addExtension(item, entry, { type: "root", tab, target: entry.id }, setting.title, "")
    })
  })
  input.servers.forEach((server) => {
    const view = (tab: SettingsServerTab, target?: string, subtab?: SettingsView["subtab"]): SettingsHostView => {
      if (input.servers.length === 1) return { type: "root", tab: tab === "general" ? "servers" : tab, target, subtab }
      return { type: "server", server: server.key, tab, target, subtab }
    }
    items.push({
      id: `server:${server.key}`,
      entity: true,
      title: server.name,
      description: "",
      keywords: "",
      owner: input.translate("settings.tab.servers"),
      page: input.translate("settings.server.section.connection"),
      server: server.key,
      view: view("general"),
    })
    if (!server.connected) return
    serverSettings.forEach((entry) => add(entry, view(entry.tab, entry.target, entry.subtab), server.name, server.key))
    // Sections on the servers page render under each server's general page.
    extensions.forEach((item) => {
      if (item.value.page !== "servers") return
      item.value.entries?.forEach((entry) =>
        addExtension(item, entry, view("general", entry.id), item.value.title, server.name, server.key),
      )
    })
    server.projects.forEach((project) => {
      const destination: SettingsView = {
        type: "project",
        server: server.key,
        project: project.worktree,
        tab: "general",
        parent: input.servers.length > 1 ? "server" : "root",
      }
      const name = displayName(project)
      items.push({
        id: `project:${server.key}:${project.worktree}`,
        entity: true,
        title: name,
        description: "",
        keywords: "",
        owner: server.name,
        page: input.translate("settings.tab.projects"),
        server: server.key,
        project: project.worktree,
        projectInfo: project,
        view: destination,
      })
      projectSettings.forEach((entry) => {
        if (entry.target === "settings-project-color" && project.icon?.override) return
        add(
          entry,
          { ...destination, tab: entry.tab, target: entry.target, subtab: entry.subtab },
          `${server.name} · ${name}`,
          server.key,
          project.worktree,
          name,
        )
      })
    })
  })
  return items
}
