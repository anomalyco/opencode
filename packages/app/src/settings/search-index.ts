import type { SettingsPage } from "@opencode/gui-extensions/sdk"
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
export type SettingsSearchExtension = { extension: string; value: SettingsPage }

export function settingsSearchIndex(input: {
  servers: readonly SettingsSearchServer[]
  /** The server per-server pages show; only its settings and projects are indexed. */
  selected?: string
  desktop: boolean
  browser: boolean
  mobile: boolean
  translate: ReturnType<typeof useLanguage>["t"]
  extensions?: readonly SettingsSearchExtension[]
}) {
  const items: SettingsSearchResult[] = []
  const multiple = input.servers.length > 1

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
                : view.tab === "servers" && multiple
                  ? "settings.tab.servers"
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
    entry: NonNullable<SettingsPage["entries"]>[number],
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
      // Rows placed in a host section read like the host's own rows there.
      icon: item.value.section ? pageIcons.general : (item.value.icon ?? pageIcons.extensions),
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

    if (setting.page === "general") {
      const section = setting.section ? input.translate("settings.general.section.general") : setting.title

      return setting.entries?.forEach((entry) =>
        addExtension(
          item,
          entry,
          { type: "root", tab: "general", target: entry.id },
          `${input.translate(pageLabels.general)} / ${section}`,
          "",
        ),
      )
    }

    // SAFETY: a SettingsPage without a host page is an extension tab under its id, as `createSettingsPages().tabs` lists.
    const tab = setting.id as SettingsExtensionTab
    const page = setting.entries?.find((entry) => entry.id === setting.id)
    addExtension(item, { ...page, id: setting.id, title: setting.title }, { type: "root", tab }, setting.title, "")
    setting.entries?.forEach((entry) => {
      if (entry.id === setting.id) return
      addExtension(item, entry, { type: "root", tab, target: entry.id }, setting.title, "")
    })
  })
  input.servers.forEach((server) => {
    // With several servers, a result names the server its page shows.
    const view = (tab: SettingsServerTab | "servers", target?: string, subtab?: SettingsView["subtab"]) =>
      ({ type: "root", tab, server: multiple ? server.key : undefined, target, subtab }) satisfies SettingsHostView

    items.push({
      id: `server:${server.key}`,
      entity: true,
      title: server.name,
      description: "",
      keywords: "",
      owner: input.translate("settings.tab.servers"),
      page: input.translate("settings.server.section.connection"),
      server: server.key,
      view: view("servers"),
    })

    if (!server.connected || server.key !== input.selected) return
    serverSettings.forEach((entry) => add(entry, view(entry.tab, entry.target, entry.subtab), server.name, server.key))
    // Sections on the servers page render with each server's connection.
    extensions.forEach((item) => {
      if (item.value.page !== "servers") return
      item.value.entries?.forEach((entry) =>
        addExtension(item, entry, view("servers", entry.id), item.value.title, server.name, server.key),
      )
    })
    server.projects.forEach((project) => {
      const destination: SettingsView = {
        type: "project",
        server: server.key,
        project: project.worktree,
        tab: "general",
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
