import { createEffect, createMemo, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useTheme } from "@opencode-ai/ui/theme"

import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
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

export function Titlebar() {
  const layout = useLayout()
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const web = createMemo(() => platform.platform === "web")
  const zoom = () => platform.webviewZoom?.() ?? 1
  const minHeight = () => (mac() ? `${40 / zoom()}px` : undefined)

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`

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
      class="h-10 shrink-0 bg-background-base relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center"
      style={{ "min-height": minHeight() }}
      onMouseDown={drag}
      onDblClick={maximize}
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
              class="size-8 rounded-md"
              onClick={layout.mobileSidebar.toggle}
              aria-label={language.t("sidebar.menu.toggle")}
            />
          </div>
        </Show>
        <Show when={!mac()}>
          <div class="xl:hidden w-[48px] shrink-0 flex items-center justify-center">
            <IconButton
              icon="menu"
              variant="ghost"
              class="size-8 rounded-md"
              onClick={layout.mobileSidebar.toggle}
              aria-label={language.t("sidebar.menu.toggle")}
            />
          </div>
        </Show>
        <div class="flex items-center gap-3 shrink-0">
          <TooltipKeybind
            class={web() ? "hidden xl:flex shrink-0 ml-14" : "hidden xl:flex shrink-0 ml-2"}
            placement="bottom"
            title={language.t("command.sidebar.toggle")}
            keybind={command.keybind("sidebar.toggle")}
          >
            <Button
              variant="ghost"
              class="group/sidebar-toggle size-6 p-0"
              onClick={layout.sidebar.toggle}
              aria-label={language.t("command.sidebar.toggle")}
              aria-expanded={layout.sidebar.opened()}
            >
              <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                <Icon
                  size="small"
                  name={layout.sidebar.opened() ? "layout-left-full" : "layout-left"}
                  class="group-hover/sidebar-toggle:hidden"
                />
                <Icon size="small" name="layout-left-partial" class="hidden group-hover/sidebar-toggle:inline-block" />
                <Icon
                  size="small"
                  name={layout.sidebar.opened() ? "layout-left" : "layout-left-full"}
                  class="hidden group-active/sidebar-toggle:inline-block"
                />
              </div>
            </Button>
          </TooltipKeybind>
          <div class="hidden xl:flex items-center gap-1 shrink-0">
            <Tooltip placement="bottom" value={language.t("common.goBack")} openDelay={2000}>
              <Button
                variant="ghost"
                icon="arrow-left"
                class="size-6 p-0"
                disabled={!canBack()}
                onClick={back}
                aria-label={language.t("common.goBack")}
              />
            </Tooltip>
            <Tooltip placement="bottom" value={language.t("common.goForward")} openDelay={2000}>
              <Button
                variant="ghost"
                icon="arrow-right"
                class="size-6 p-0"
                disabled={!canForward()}
                onClick={forward}
                aria-label={language.t("common.goForward")}
              />
            </Tooltip>
          </div>
        </div>
        <div id="opencode-titlebar-left" class="flex items-center gap-3 min-w-0 px-2" />
      </div>

      <div class="min-w-0 flex items-center justify-center pointer-events-none lg:absolute lg:inset-0 lg:flex lg:items-center lg:justify-center">
        <div id="opencode-titlebar-center" class="pointer-events-auto w-full min-w-0 flex justify-center lg:w-fit" />
      </div>

      <div
        classList={{
          "flex items-center min-w-0 justify-end": true,
          "pr-6": !windows(),
        }}
        onMouseDown={drag}
      >
        <div id="opencode-titlebar-right" class="flex items-center gap-3 shrink-0 justify-end" />
        <Show when={windows()}>
          <div class="w-6 shrink-0" />
          <div data-tauri-decorum-tb class="flex flex-row" />
        </Show>
      </div>
    </header>
  )
}
