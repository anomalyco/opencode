import { createEffect, createMemo, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useTheme } from "@opencode-ai/ui/theme/context"

import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { applyPath, backPath, forwardPath } from "./titlebar-history"

type TauriDesktopWindow = {
  startDragging?: () => Promise<void>
  toggleMaximize?: () => Promise<void>
}

type TauriThemeWindow = {
  setTheme?: (theme?: "light" | "dark" | null) => Promise<void>
}

type TauriApi = {
  window?: {
    getCurrentWindow?: () => TauriDesktopWindow
  }
  webviewWindow?: {
    getCurrentWebviewWindow?: () => TauriThemeWindow
  }
}

const tauriApi = () => (window as unknown as { __TAURI__?: TauriApi }).__TAURI__
const currentDesktopWindow = () => tauriApi()?.window?.getCurrentWindow?.()
const currentThemeWindow = () => tauriApi()?.webviewWindow?.getCurrentWebviewWindow?.()
const titlebarHeight = 40
const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138 // 3 native Windows caption buttons at 46px each.

export function Titlebar() {
  const layout = useLayout()
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const web = createMemo(() => platform.platform === "web")
  const zoom = () => platform.webviewZoom?.() ?? 1
  const titlebarZoom = () => (windows() ? Math.max(zoom(), minTitlebarZoom) : zoom())
  const counterZoom = () => (windows() && titlebarZoom() < 1 ? 1 / titlebarZoom() : 1)
  const minHeight = () => {
    if (mac()) return `${titlebarHeight / zoom()}px`
    if (windows()) return `${titlebarHeight / Math.min(titlebarZoom(), 1)}px`
    return undefined
  }
  const windowsControlsWidth = () => `${windowsControlsBaseWidth / Math.max(titlebarZoom(), 1)}px`

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`
  const creating = createMemo(() => {
    if (!params.dir) return false
    if (params.id) return false
    const parts = location.pathname.replace(/\/+$/, "").split("/")
    return parts.at(-1) === "session"
  })

  createEffect(() => {
    const current = path()

    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const canBack = createMemo(() => history.index > 0)
  const canForward = createMemo(() => history.index < history.stack.length - 1)
  const hasProjects = createMemo(() => layout.projects.list().length > 0)
  const nav = createMemo(() => import.meta.env.VITE_OPENCODE_CHANNEL !== "beta" || settings.general.showNavigation())

  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  const getWin = () => {
    if (platform.platform !== "desktop") return
    return currentDesktopWindow()
  }

  createEffect(() => {
    if (platform.platform !== "desktop") return

    const scheme = theme.colorScheme()
    const value = scheme === "system" ? null : scheme

    const win = currentThemeWindow()
    if (!win?.setTheme) return

    void win.setTheme(value).catch(() => undefined)
  })

  const interactive = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false

    const selector =
      "button, a, input, textarea, select, option, [role='button'], [role='menuitem'], [contenteditable='true'], [contenteditable='']"

    return !!target.closest(selector)
  }

  const drag = (e: MouseEvent) => {
    if (platform.platform !== "desktop") return
    if (e.buttons !== 1) return
    if (interactive(e.target)) return

    const win = getWin()
    if (!win?.startDragging) return

    e.preventDefault()
    void win.startDragging().catch(() => undefined)
  }

  const maximize = (e: MouseEvent) => {
    if (platform.platform !== "desktop") return
    if (interactive(e.target)) return
    if (e.target instanceof Element && e.target.closest("[data-tauri-decorum-tb]")) return

    const win = getWin()
    if (!win?.toggleMaximize) return

    e.preventDefault()
    void win.toggleMaximize().catch(() => undefined)
  }

  return (
    <header
      class="h-10 shrink-0 bg-background-base relative overflow-hidden"
      style={{ "min-height": minHeight() }}
      data-tauri-drag-region
      onMouseDown={drag}
      onDblClick={maximize}
    >
      <div
        class="grid h-full min-h-full w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
        style={{ zoom: counterZoom() }}
      >
        <div
          classList={{
            "flex items-center min-w-0": true,
            "pl-2": !mac(),
          }}
        >
          <Show when={mac()}>
            <div class="h-full shrink-0" style={{ width: `${72 / zoom()}px` }} />
            <div class="xl:hidden w-10 shrink-0 flex items-center justify-center">
              <IconButton
                icon="menu"
                variant="ghost"
                class="titlebar-icon rounded-md"
                onClick={layout.mobileSidebar.toggle}
                aria-label={language.t("sidebar.menu.toggle")}
                aria-expanded={layout.mobileSidebar.opened()}
              />
            </div>
          </Show>
          <Show when={!mac()}>
            <div class="xl:hidden w-[48px] shrink-0 flex items-center justify-center">
              <IconButton
                icon="menu"
                variant="ghost"
                class="titlebar-icon rounded-md"
                onClick={layout.mobileSidebar.toggle}
                aria-label={language.t("sidebar.menu.toggle")}
                aria-expanded={layout.mobileSidebar.opened()}
              />
            </div>
          </Show>
          <div class="flex items-center gap-1 shrink-0">
            <TooltipKeybind
              class={web() ? "hidden xl:flex shrink-0 ml-14" : "hidden xl:flex shrink-0 ml-2"}
              placement="bottom"
              title={language.t("command.sidebar.toggle")}
              keybind={command.keybind("sidebar.toggle")}
            >
              <Button
                variant="ghost"
                class="group/sidebar-toggle titlebar-icon w-8 h-6 p-0 box-border"
                onClick={layout.sidebar.toggle}
                aria-label={language.t("command.sidebar.toggle")}
                aria-expanded={layout.sidebar.opened()}
              >
                <Icon size="small" name={layout.sidebar.opened() ? "sidebar-active" : "sidebar"} />
              </Button>
            </TooltipKeybind>
            <div class="hidden xl:flex items-center shrink-0">
              <Show when={params.dir}>
                <div
                  class="flex items-center shrink-0 w-8 mr-1"
                  aria-hidden={layout.sidebar.opened() ? "true" : undefined}
                >
                  <div
                    class="transition-opacity"
                    classList={{
                      "opacity-100 duration-120 ease-out": !layout.sidebar.opened(),
                      "opacity-0 duration-120 ease-in delay-0 pointer-events-none": layout.sidebar.opened(),
                    }}
                  >
                    <TooltipKeybind
                      placement="bottom"
                      title={language.t("command.session.new")}
                      keybind={command.keybind("session.new")}
                      openDelay={2000}
                    >
                      <Button
                        variant="ghost"
                        icon={creating() ? "new-session-active" : "new-session"}
                        class="titlebar-icon w-8 h-6 p-0 box-border"
                        disabled={layout.sidebar.opened()}
                        tabIndex={layout.sidebar.opened() ? -1 : undefined}
                        onClick={() => {
                          if (!params.dir) return
                          navigate(`/${params.dir}/session`)
                        }}
                        aria-label={language.t("command.session.new")}
                        aria-current={creating() ? "page" : undefined}
                      />
                    </TooltipKeybind>
                  </div>
                </div>
              </Show>
              <div
                class="flex items-center shrink-0"
                classList={{
                  "-translate-x-[36px]": layout.sidebar.opened() && !!params.dir,
                  "duration-180 ease-out": !layout.sidebar.opened(),
                  "duration-180 ease-in": layout.sidebar.opened(),
                }}
              >
                <Show when={hasProjects() && nav()}>
                  <div class="flex items-center gap-0 transition-transform">
                    <Tooltip placement="bottom" value={language.t("common.goBack")} openDelay={2000}>
                      <Button
                        variant="ghost"
                        icon="chevron-left"
                        class="titlebar-icon w-6 h-6 p-0 box-border"
                        disabled={!canBack()}
                        onClick={back}
                        aria-label={language.t("common.goBack")}
                      />
                    </Tooltip>
                    <Tooltip placement="bottom" value={language.t("common.goForward")} openDelay={2000}>
                      <Button
                        variant="ghost"
                        icon="chevron-right"
                        class="titlebar-icon w-6 h-6 p-0 box-border"
                        disabled={!canForward()}
                        onClick={forward}
                        aria-label={language.t("common.goForward")}
                      />
                    </Tooltip>
                  </div>
                </Show>
                <div id="opencode-titlebar-left" class="flex items-center gap-3 min-w-0 px-2" />
                {["beta", "dev"].includes(import.meta.env.VITE_OPENCODE_CHANNEL) && (
                  <div class="bg-icon-interactive-base text-[#FFF] font-medium px-2 rounded-sm uppercase font-mono">
                    {import.meta.env.VITE_OPENCODE_CHANNEL.toUpperCase()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div class="min-w-0 flex items-center justify-center pointer-events-none">
          <div id="opencode-titlebar-center" class="pointer-events-auto min-w-0 flex justify-center w-fit max-w-full" />
        </div>

        <div
          classList={{
            "flex items-center min-w-0 justify-end": true,
            "pr-2": !windows(),
          }}
          data-tauri-drag-region
          onMouseDown={drag}
        >
          <div id="opencode-titlebar-right" class="flex items-center gap-1 shrink-0 justify-end" />
          <Show when={windows()}>
            {!tauriApi() && <div class="shrink-0" style={{ width: windowsControlsWidth() }} />}
            <div data-tauri-decorum-tb class="flex flex-row" />
          </Show>
        </div>
      </div>
    </header>
  )
}
