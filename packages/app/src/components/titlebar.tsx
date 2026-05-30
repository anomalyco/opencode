import { createEffect, createMemo, onCleanup, onMount, Show, untrack, type ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useTheme } from "@opencode-ai/ui/theme"
import { Popover } from "@opencode-ai/ui/popover"

import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
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
  const params = useParams()
  const globalSDK = useGlobalSDK()

  const [user, setUser] = createStore({ email: "" as string | null, loggedIn: false as boolean })

  onMount(async () => {
    try {
      const res = await fetch(`${globalSDK.url}/auth/session`, { credentials: "include" })
      if (res.ok) {
        const data = (await res.json()) as { user: { email: string } | null }
        if (data.user) {
          setUser("email", data.user.email)
          setUser("loggedIn", true)
        }
      }
    } catch {
      // Session check failed
    }
  })

  const handleAuth = () => {
    if (user.loggedIn) {
      window.location.href = `${globalSDK.url}/auth/logout`
    } else {
      window.location.href = `${globalSDK.url}/auth/login`
    }
  }

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
  const startNewSession = () => {
    if (!params.dir) return

    if (params.id) {
      const source = layout.tabs(`${params.dir}/${params.id}`).tabs()
      if (source.all.length > 0 || source.active) {
        const target = layout.tabs(params.dir)
        target.setAll(source.all)
        target.setActive(source.active && source.all.includes(source.active) ? source.active : source.all[0])
      }
    }

    navigate(`/${params.dir}/session`)
  }

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
      class="h-10 shrink-0 relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
      style={{
        "min-height": minHeight(),
        "background-color": "color-mix(in srgb, var(--background-base) 75%, transparent)",
        "backdrop-filter": "blur(24px)",
        "border-bottom": "1px solid var(--border-weak-base)",
      }}
      data-tauri-drag-region
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
          <Show when={params.dir}>
            <button
              onClick={() => navigate("/")}
              class="titlebar-pill-button active shrink-0 mr-1"
            >
              <Icon name="arrow-left" size="small" />
              Projects
            </button>
          </Show>

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
              <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                <Icon
                  size="small"
                  name={layout.sidebar.opened() ? "layout-left-partial" : "layout-left"}
                  class="group-hover/sidebar-toggle:hidden"
                />
                <Icon size="small" name="layout-left-partial" class="hidden group-hover/sidebar-toggle:inline-block" />
                <Icon
                  size="small"
                  name={layout.sidebar.opened() ? "layout-left" : "layout-left-partial"}
                  class="hidden group-active/sidebar-toggle:inline-block"
                />
              </div>
            </Button>
          </TooltipKeybind>


          <div class="hidden xl:flex items-center shrink-0">
            <div class="flex items-center gap-0" classList={{ "ml-1": !!params.dir }}>
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
          </div>
        </div>
        <div id="opencode-titlebar-left" class="flex items-center gap-3 min-w-0 px-2" />
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
        <Show when={params.dir}>
          <TooltipKeybind
            placement="bottom"
            title="Toggle AI Copilot"
            keybind={command.keybind("session.toggle")}
          >
            <button
              onClick={() => layout.session.toggle()}
              class="titlebar-pill-button shrink-0 mr-2"
              classList={{ active: layout.session.opened() }}
            >
              <Icon name="models" size="small" />
              AI Copilot
            </button>
          </TooltipKeybind>
        </Show>
        <Show when={!user.loggedIn}>
          <Button variant="ghost" class="titlebar-icon h-6 px-2 box-border text-12-regular" onClick={handleAuth}>
            Login
          </Button>
        </Show>
        <Show when={user.loggedIn}>
          <Popover
            title={user.email ?? "Account"}
            gutter={4}
            placement="bottom-end"
            class="rounded-xl [&_[data-slot=popover-close-button]]:hidden"
            triggerAs="button"
            triggerProps={{
              type: "button",
              "data-component": "button",
              "data-size": "normal",
              "data-variant": "ghost",
              class: "titlebar-icon h-6 px-2 box-border text-12-regular flex items-center gap-1.5 cursor-pointer outline-none",
            } as unknown as ComponentProps<"button">}
            trigger={
              <>
                <svg class="size-3.5 text-icon-weak" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 17v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1" />
                  <circle cx="10" cy="7" r="4" />
                </svg>
                {user.email?.split("@")[0] ?? "pelegreenall"}
              </>
            }
          >
            <div class="flex flex-col p-1 min-w-[120px]">
              <Button
                size="small"
                variant="ghost"
                class="w-full justify-start text-text-strong hover:bg-surface-base-hover rounded-md px-2 py-1.5 text-12-regular cursor-pointer"
                onClick={handleAuth}
              >
                Logout
              </Button>
            </div>
          </Popover>
        </Show>
        <div id="opencode-titlebar-right" class="flex items-center gap-1 shrink-0 justify-end" />
        <Show when={windows()}>
          {!tauriApi() && <div class="w-36 shrink-0" />}
          <div data-tauri-decorum-tb class="flex flex-row" />
        </Show>
      </div>
    </header>
  )
}
