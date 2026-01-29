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

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`

  createEffect(() => {
    const current = path()

    untrack(() => {
      if (!history.stack.length) {
        const stack = current === "/" ? ["/"] : ["/", current]
        setHistory({ stack, index: stack.length - 1 })
        return
      }

      const active = history.stack[history.index]
      if (current === active) {
        if (history.action) setHistory("action", undefined)
        return
      }

      if (history.action) {
        setHistory("action", undefined)
        return
      }

      const next = history.stack.slice(0, history.index + 1).concat(current)
      setHistory({ stack: next, index: next.length - 1 })
    })
  })

  const canBack = createMemo(() => history.index > 0)
  const canForward = createMemo(() => history.index < history.stack.length - 1)

  const back = () => {
    if (!canBack()) return
    const index = history.index - 1
    const to = history.stack[index]
    if (!to) return
    setHistory({ index, action: "back" })
    navigate(to)
  }

  const forward = () => {
    if (!canForward()) return
    const index = history.index + 1
    const to = history.stack[index]
    if (!to) return
    setHistory({ index, action: "forward" })
    navigate(to)
  }

  const getWin = () => {
    if (platform.platform !== "desktop") return

    const tauri = (
      window as unknown as {
        __TAURI__?: { window?: { getCurrentWindow?: () => { startDragging?: () => Promise<void> } } }
      }
    ).__TAURI__
    if (!tauri?.window?.getCurrentWindow) return

    return tauri.window.getCurrentWindow()
  }

  createEffect(() => {
    if (platform.platform !== "desktop") return

    const scheme = theme.colorScheme()
    const value = scheme === "system" ? null : scheme

    const tauri = (window as unknown as { __TAURI__?: { webviewWindow?: { getCurrentWebviewWindow?: () => unknown } } })
      .__TAURI__
    const get = tauri?.webviewWindow?.getCurrentWebviewWindow
    if (!get) return

    const win = get() as { setTheme?: (theme?: "light" | "dark" | null) => Promise<void> }
    if (!win.setTheme) return

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

  return (
    <header class="h-10 shrink-0 bg-background-base flex items-center relative" data-tauri-drag-region>
      <div
        classList={{
          "flex items-center w-full min-w-0": true,
          "pl-2": !mac(),
          "pr-6": !windows(),
        }}
        onMouseDown={drag}
        data-tauri-drag-region
      >
        <Show when={mac()}>
          <div class="w-[72px] h-full shrink-0" data-tauri-drag-region />
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
        <div id="opencode-titlebar-left" class="flex items-center gap-3 min-w-0 px-2" data-tauri-drag-region />
        <div class="flex-1 h-full" data-tauri-drag-region />
        <div
          id="opencode-titlebar-right"
          class="flex items-center gap-3 shrink-0 flex-1 justify-end"
          data-tauri-drag-region
        />
        <Show when={windows()}>
          <div class="w-6 shrink-0" />
          <div data-tauri-decorum-tb class="flex flex-row" />
        </Show>
      </div>
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div id="opencode-titlebar-center" class="pointer-events-auto" />
      </div>
    </header>
  )
}
