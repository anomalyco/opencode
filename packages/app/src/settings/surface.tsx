import { useLocation, useNavigate } from "@solidjs/router"
import { batch, createEffect, createMemo, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode/ui/context"
import { useLayout, type LayoutRoute } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { ServerConnection } from "@/runtime/server/registry"
import { useCommand } from "@/shell/commands/command"
import { createSettingsPages } from "@/runtime/plugin/settings-pages"
import { useSettingsServers } from "./servers/inventory"
import {
  isPluginTab,
  isProjectTab,
  isRootTab,
  parseSettingsView,
  settingsViewUrl,
  type SettingsPluginTab,
  type SettingsProjectTab,
  type SettingsRootTab,
  type SettingsTransientView,
  type SettingsView,
} from "./route"

export type {
  SettingsPluginTab,
  SettingsHostView,
  SettingsProjectTab,
  SettingsRootTab,
  SettingsServerTab,
  SettingsView,
} from "./route"

export const { use: useSettingsSurface, provider: SettingsSurfaceProvider } = createSimpleContext({
  name: "SettingsSurface",
  gate: false,
  init: () => {
    const navigate = useNavigate()
    const layout = useLayout()
    const command = useCommand()
    const servers = useSettingsServers()
    const tabs = useTabs()

    const location = useLocation<{
      settings?: { route: Exclude<LayoutRoute, { type: "settings" }>; view?: SettingsTransientView }
    }>()

    const plugins = createSettingsPages()
    const open = () => layout.route().type === "settings"

    // While Settings is closed, the current tab is where it would open from.
    const source = () => {
      const route = layout.route()

      if (route.type !== "settings") return route

      return location.state?.settings?.route ?? { type: "home" as const }
    }

    const view = () => parseSettingsView(location.search, location.state?.settings?.view, plugins.tabs())

    // The server of the tab settings opened from, which per-server pages show until another is selected.
    const sourceServer = createMemo(() => {
      const route = source()

      if (route.type === "session") return route.server

      if (route.type === "draft")
        return tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)?.server

      return layout.home.selection().server
    })

    const server = createMemo(() => {
      const list = servers()
      const key = view().server ?? sourceServer()

      return (
        list.find((item) => item.key === key) ??
        list.find((item) => !!item.connection && ServerConnection.local(item.connection)) ??
        list[0]
      )
    })

    const [search, setSearch] = createStore<{
      query: string
      origin: SettingsView | undefined
      selected: string
      highlighted: string
      scrollTop: number
      activation: number
      expanded: boolean
    }>({
      query: "",
      origin: undefined,
      selected: "",
      highlighted: "",
      scrollTop: 0,
      activation: 0,
      expanded: true,
    })

    let focus: HTMLElement | undefined

    const show = (view: SettingsView) => {
      const route = layout.route()

      if (route.type !== "settings" && document.activeElement instanceof HTMLElement) focus = document.activeElement
      navigate(settingsViewUrl(view), {
        replace: route.type === "settings",
        state: {
          settings: {
            route: route.type === "settings" ? source() : route,
            view: { target: view.target, searchActivation: view.searchActivation },
          },
        },
      })
    }

    createEffect(
      on(
        open,
        (value) => {
          if (value) return
          setSearch({ query: "", origin: undefined, selected: "", highlighted: "", scrollTop: 0, expanded: true })

          if (focus?.isConnected) focus.focus({ preventScroll: true })
          focus = undefined
        },
        { defer: true },
      ),
    )

    return {
      active: open,
      route: source,
      view,
      /** The server per-server pages show; undefined only while no server is listed. */
      server,
      sourceServer,
      plugins,
      search: {
        state: search,
        input(query: string) {
          if (!search.query.trim() && query.trim()) setSearch("origin", { ...view(), target: undefined })
          setSearch({ query, highlighted: "", scrollTop: 0, expanded: true })

          if (!query.trim()) setSearch({ selected: "", origin: undefined })
        },
        expand() {
          setSearch("expanded", true)
        },
        highlight(id: string) {
          setSearch("highlighted", id)
        },
        scroll(scrollTop: number) {
          setSearch("scrollTop", scrollTop)
        },
        open(destination: SettingsView, id: string) {
          batch(() => {
            show({ ...destination, searchActivation: search.activation + 1 })
            setSearch({ selected: id, highlighted: id, expanded: false, activation: search.activation + 1 })
          })
        },
        clear() {
          setSearch({ query: "", selected: "", highlighted: "", scrollTop: 0, origin: undefined, expanded: true })
        },
        back() {
          if (!search.query.trim() || !search.selected || !search.origin) return false
          show(search.origin)
          setSearch({ selected: "", expanded: true })

          return true
        },
      },
      open(tab: SettingsRootTab | SettingsPluginTab = "general") {
        show({ type: "root", tab })
      },
      /** Shows another server on the per-server pages, staying on the current page. */
      selectServer(server: string) {
        const current = view()

        if (current.type !== "root") return
        show({ ...current, server, target: undefined })
      },
      openServers(server?: string) {
        show({ type: "root", tab: "servers", server })
      },
      replace(view: SettingsView) {
        show(view)
      },
      openProject(input: { server: string; project: string; tab?: SettingsProjectTab }) {
        show({ type: "project", ...input, tab: input.tab ?? "general" })
      },
      select(tab: string) {
        const current = view()

        const next: SettingsView =
          current.type === "root" && (isRootTab(tab) || isPluginTab(tab, plugins.tabs()))
            ? { ...current, tab }
            : current.type === "project" && isProjectTab(tab)
              ? { ...current, tab }
              : current

        show({ ...next, target: undefined, subtab: undefined })
      },
      subtab(subtab: SettingsView["subtab"]) {
        show({ ...view(), subtab, target: undefined })
      },
      back() {
        const current = view()

        if (current.type === "root") {
          command.trigger("common.goBack")

          return
        }

        show({ type: "root", tab: "projects", server: current.server })
      },
      close() {
        if (open()) command.trigger("common.goBack")
      },
    }
  },
})
