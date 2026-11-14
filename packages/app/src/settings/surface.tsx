import { useLocation, useNavigate } from "@solidjs/router"
import { batch, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import { useLayout, type LayoutRoute } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { useServers } from "@/runtime/server/registry"
import { useCommand } from "@/shell/commands/command"
import { createSettingsPages } from "@/runtime/plugin/settings-pages"
import { useSettingsServers } from "./servers/inventory"
import {
  canReturnToSearchOrigin,
  createSettingsSearchState,
  isSearchActive,
  isSearchExpanded,
  selectSearchHighlighted,
  selectSearchQuery,
  selectSearchScrollTop,
  selectSearchSelected,
  transitionSettingsSearch,
  type SettingsSearchEvent,
} from "./search-machine"
import { startSettingsSearchReveal } from "./search-reveal"
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
    const registry = useServers()
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
        list.find((item) => !!item.connection && registry.local(item.connection)) ??
        list[0]
      )
    })

    const [searchState, setSearchState] = createSignal(createSettingsSearchState())
    let focus: HTMLElement | undefined
    let screen: HTMLElement | undefined
    let stopReveal: (() => void) | undefined
    let revealTimer: ReturnType<typeof setTimeout> | undefined

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

    const back = () => {
      const current = view()

      if (current.type === "root") {
        command.trigger("common.goBack")

        return
      }

      show({ type: "root", tab: "projects", server: current.server })
    }

    const stop = () => {
      clearTimeout(revealTimer)
      revealTimer = undefined
      stopReveal?.()
      stopReveal = undefined
    }

    // Untracked, so the effect that syncs the view does not rerun for search changes or the reads effects make.
    const dispatch = (event: SettingsSearchEvent): void =>
      untrack(() =>
        batch(() => {
          const current = searchState()
          const next = transitionSettingsSearch(current, event)

          if (next.state !== current) setSearchState(next.state)
          next.effects.forEach((effect) => {
            if (effect.type === "navigate") return show(effect.view)

            if (effect.type === "exit") return back()

            if (effect.type === "reveal.cancel") return stop()

            if (effect.type === "reveal.highlight") {
              clearTimeout(revealTimer)
              revealTimer = setTimeout(
                () => dispatch({ type: "reveal.timed-out", activation: effect.activation }),
                effect.timeoutMs,
              )

              return
            }

            stop()
            // The timeout also settles a reveal whose screen is already gone.
            revealTimer = setTimeout(
              () => dispatch({ type: "reveal.timed-out", activation: effect.activation }),
              effect.timeoutMs,
            )

            if (!screen) return
            stopReveal = startSettingsSearchReveal(screen, effect.view, {
              onHighlighted: () => dispatch({ type: "reveal.highlighted", activation: effect.activation }),
              onCompleted: () => dispatch({ type: "reveal.completed", activation: effect.activation }),
            })
          })
        }),
      )

    onCleanup(stop)

    createEffect(
      on(
        open,
        (value) => {
          if (value) return
          dispatch({ type: "settings.closed" })

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
        query: () => selectSearchQuery(searchState()),
        active: () => isSearchActive(searchState()),
        expanded: () => isSearchExpanded(searchState()),
        selected: () => selectSearchSelected(searchState()),
        highlighted: () => selectSearchHighlighted(searchState()),
        scrollTop: () => selectSearchScrollTop(searchState()),
        canReturn: () => canReturnToSearchOrigin(searchState(), view()),
        input(query: string) {
          dispatch({ type: "input.changed", query, view: view() })
        },
        expand() {
          dispatch({ type: "expanded" })
        },
        highlight(id: string) {
          dispatch({ type: "highlighted", id })
        },
        scroll(scrollTop: number) {
          dispatch({ type: "scrolled", scrollTop })
        },
        open(destination: SettingsView, id: string) {
          dispatch({ type: "result.opened", id, destination })
        },
        /** Opens a Command Palette pick without starting a sidebar search. */
        reveal(destination: SettingsView) {
          dispatch({ type: "palette.opened", destination })
        },
        clear() {
          dispatch({ type: "cleared" })
        },
        back() {
          dispatch({ type: "back.requested", view: view() })
        },
        escape() {
          dispatch({ type: "escape.pressed", view: view() })
        },
        /** Lets reveals run in the mounted screen, and stops them when it unmounts. */
        attach(root: HTMLElement) {
          screen = root

          return () => {
            screen = undefined
            dispatch({ type: "screen.unmounted" })
          }
        },
        /** The mounted screen reports each view it shows, which starts or ends an activation's reveal. */
        sync(current: SettingsView) {
          dispatch({ type: "view.synced", view: current })
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
      back,
      close() {
        if (open()) command.trigger("common.goBack")
      },
    }
  },
})
