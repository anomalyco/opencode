import { createEffect, createMemo, For, mapArray, Match, Show, startTransition, Switch, untrack } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useLocation, useMatch, useNavigate, useParams } from "@solidjs/router"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { IconButtonV2 } from "@opencode-ai/ui/v2/components/icon-button-v2.jsx"

import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { WindowsAppMenu } from "./windows-app-menu"
import { applyPath, backPath, forwardPath } from "./titlebar-history"
import { useGlobalSync } from "@/context/global-sync"
import { decodeDirectory } from "@/pages/directory-layout"
import { iife } from "@opencode-ai/core/util/iife"

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

const makeSessionHref = (b64Dir: string, sessionId: string) => `/${b64Dir}/session/${sessionId}`

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
  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
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
      class="h-10 shrink-0 bg-background-base relative overflow-hidden flex flex-row"
      style={{ "min-height": minHeight(), "padding-left": mac() ? `${84 / zoom()}px` : 0 }}
      data-tauri-drag-region
      onMouseDown={drag}
      onDblClick={maximize}
    >
      <Switch>
        <Match when={import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"}>
          {(_) => {
            const globalSync = useGlobalSync()
            const navigate = useNavigate()

            type Tab = { dir: string; sessionId: string; params: any; href: string }

            const [tabsStore, tabsStoreActions] = iife(() => {
              const [store, setStore] = createStore<Tab[]>(
                iife(() => {
                  if (!params.dir || !params.id) return []
                  return [
                    {
                      dir: decodeDirectory(params.dir) ?? "",
                      sessionId: params.id,
                      params: { id: params.id, dir: params.dir },
                      href: makeSessionHref(params.dir, params.id),
                    },
                  ]
                }),
              )

              const actions = {
                addTab: (tab: Tab) => {
                  setStore(
                    produce((tabs) => {
                      if (tabs.some((t) => t.href === tab.href)) return

                      tabs.push(tab)
                    }),
                  )
                },
                removeTab: (href: string) => {
                  startTransition(() => {
                    setStore(
                      produce((tabs) => {
                        const index = tabs.findIndex((t) => t.href === href)
                        if (index === -1) return
                        tabs.splice(index, 1)
                        const nextTab = tabs[index] ?? tabs[tabs.length - 1]
                        if (nextTab) navigate(nextTab.href)
                        else navigate("/")
                      }),
                    )
                  })
                },
              }

              return [store, actions]
            })

            createEffect(() => {
              const params = useParams()
              if (!(params.dir && params.id)) return

              tabsStoreActions.addTab({
                dir: decodeDirectory(params.dir) ?? "",
                sessionId: params.id,
                params: { id: params.id, dir: params.dir },
                href: makeSessionHref(params.dir, params.id),
              })
            })

            const tabsEnriched = iife(() => {
              const base = mapArray(
                () => tabsStore,
                (tab) => {
                  const sync = globalSync.createDirSyncContext(tab.dir)
                  const session = sync.session.get(tab.sessionId)
                  return session ? { ...tab, info: session } : null
                },
              )

              return () => base().flatMap((s) => (s ? [s] : []))
            })

            return (
              <div class="h-full flex-1 flex flex-row items-center gap-1.5 pr-3">
                <ChannelIndicator />
                <Show when={windows() || linux()}>
                  <WindowsAppMenu command={command} platform={platform} />
                </Show>
                <IconButtonV2
                  as="a"
                  href="/"
                  variant="ghost-muted"
                  size="large"
                  class="!w-8"
                  state={!!useMatch(() => "/")() ? "pressed" : undefined}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M13.9948 11.668H9.32812M11.6641 9.33203V13.9987M6.66667 9.33203V13.9987H2V9.33203H6.66667ZM6.66667 2V6.66667H2V2H6.66667ZM13.9948 2V6.66667H9.32812V2H13.9948Z"
                      stroke="currentColor"
                      stroke-miterlimit="10"
                      stroke-linecap="square"
                    />
                  </svg>
                </IconButtonV2>
                <div class="flex flex-row items-center gap-2">
                  <For each={tabsEnriched()}>
                    {(tab, i) => (
                      <>
                        {i() !== 0 && <div class="w-[1.5px] h-3 rounded-full bg-[var(--v2-background-bg-layer-02)]" />}
                        <TabNavItem
                          href={tab.href}
                          title={tab.info.title}
                          onClose={() => tabsStoreActions.removeTab(tab.href)}
                          hideClose={tabsEnriched().length < 2}
                        />
                      </>
                    )}
                  </For>
                </div>
                <button>
                  <div class="p-1.5">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      class="size-4"
                    >
                      <path
                        d="M7.99978 2.88867V13.1109M2.88867 7.99978H13.1109"
                        stroke="#808080"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </div>
                </button>

                <div class="flex-1" />
                {/*<button class="px-2.5 py-1.5 bg-[rgba(0,0,0,0.08)] rounded-[6px]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    class="size-4"
                  >
                    <path
                      d="M10.4443 2.44436V13.5555M1.55546 13.5554H14.4443V2.44434H1.55542L1.55546 13.5554Z"
                      stroke="#3A3A3A"
                    />
                  </svg>
                </button>*/}
              </div>
            )
          }}
        </Match>
        <Match when>
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
              <Show when={windows() || linux()}>
                <WindowsAppMenu command={command} platform={platform} />
              </Show>
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
                    <ChannelIndicator />
                  </div>
                </div>
              </div>
            </div>

            <div class="min-w-0 flex items-center justify-center pointer-events-none">
              <div
                id="opencode-titlebar-center"
                class="pointer-events-auto min-w-0 flex justify-center w-fit max-w-full"
              />
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
        </Match>
      </Switch>
    </header>
  )
}

function TabNavItem(props: { href: string; title: string; hideClose?: boolean; onClose: () => void }) {
  const match = useMatch(() => props.href)
  const isActive = () => !!match()
  return (
    <div
      class="group flex flex-row items-center max-w-60 whitespace-nowrap [--tab-bg:var(--v2-background-bg-deep)] data-[active='true']:[--tab-bg:var(--v2-background-bg-layer-02)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] bg-[var(--tab-bg)] h-7 rounded-[6px] relative overflow-hidden"
      data-active={isActive()}
    >
      <a
        href={props.href}
        class="w-full h-full pl-1.5 flex-1 max-w-full flex flex-row items-center overflow-hidden font-medium"
      >
        {props.title}
      </a>

      <div class="absolute right-0 inset-y-0 flex flex-row items-center pr-1 py-1 w-8 pl-2">
        <div
          class="absolute inset-0 bg-(image:--inactive-bg) group-hover:bg-(image:--active-bg) group-data-[active=true]:bg-(image:--active-bg)"
          style={{
            "--inactive-bg": "linear-gradient(to right, transparent 0%, var(--tab-bg) 80%)",
            "--active-bg": "linear-gradient(90deg, transparent 0%, var(--tab-bg) 25%)",
          }}
        />
        <IconButtonV2
          size="small"
          variant="ghost-muted"
          class="opacity-0 group-hover:opacity-100 group-data-[active='true']:opacity-100"
          onClick={props.onClose}
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              class="size-4"
            >
              <path d="M4.25 11.75L11.75 4.25M11.75 11.75L4.25 4.25" stroke="currentColor" />
            </svg>
          }
        />
      </div>
    </div>
  )
}
function ChannelIndicator() {
  return (
    <>
      {["beta", "dev"].includes(import.meta.env.VITE_OPENCODE_CHANNEL) && (
        <div class="bg-icon-interactive-base text-[#FFF] font-medium px-2 rounded-sm uppercase font-mono">
          {import.meta.env.VITE_OPENCODE_CHANNEL.toUpperCase()}
        </div>
      )}
    </>
  )
}
