import { createEffect, createMemo, For, mapArray, Match, Show, startTransition, Switch, untrack } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useLocation, useMatch, useNavigate, useParams } from "@solidjs/router"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"

import { getProjectAvatarVariant, useLayout, type LocalProject } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { WindowsAppMenu } from "./windows-app-menu"
import { applyPath, backPath, forwardPath } from "./titlebar-history"
import { useServerSync } from "@/context/server-sync"
import { decodeDirectory } from "@/pages/directory-layout"
import { iife } from "@opencode-ai/core/util/iife"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { displayName, getProjectAvatarSource, projectForSession } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { makeEventListener } from "@solid-primitives/event-listener"
import {
  readSessionTabsRemovedDetail,
  SESSION_TABS_REMOVED_EVENT,
  type SessionTabsRemovedDetail,
} from "@/components/titlebar-session-events"

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
const legacyTitlebarHeight = 40
const v2TitlebarHeight = 36
const minTitlebarZoom = 0.25
const windowsControlsBaseWidth = 138 // 3 native Windows caption buttons at 46px each.

const makeSessionHref = (b64Dir: string, sessionId: string) => `/${b64Dir}/session/${sessionId}`

export type TitlebarUpdate = {
  version: () => string | undefined
  installing: () => boolean
  install: () => void
}

export function Titlebar(props: { update?: TitlebarUpdate }) {
  const layout = useLayout()
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const settings = useSettings()
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const useV2Titlebar = createMemo(() => settings.general.newLayoutDesigns())

  const mac = createMemo(() => platform.platform === "desktop" && platform.os === "macos")
  const windows = createMemo(() => platform.platform === "desktop" && platform.os === "windows")
  const electronWindows = createMemo(() => windows() && !tauriApi())
  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const web = createMemo(() => platform.platform === "web")
  const zoom = () => platform.webviewZoom?.() ?? 1
  const titlebarZoom = () => (windows() ? Math.max(zoom(), minTitlebarZoom) : zoom())
  const counterZoom = () => (windows() && titlebarZoom() < 1 ? 1 / titlebarZoom() : 1)
  const minHeight = () => {
    const height = useV2Titlebar() ? v2TitlebarHeight : legacyTitlebarHeight
    if (mac()) return `${height / zoom()}px`
    if (windows()) return `${height / Math.min(titlebarZoom(), 1)}px`
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
  const nav = createMemo(() => (useV2Titlebar() ? settings.general.showNavigation() : true))
  const updateState = createMemo<TitlebarUpdatePillState>(() => {
    const version = props.update?.version()
    return {
      visible: version !== undefined,
      installing: props.update?.installing() ?? false,
      label: "Update",
      ariaLabel: language.t("toast.update.action.installRestart"),
      title: version ? `Update ${version}` : undefined,
      onInstall: () => props.update?.install(),
    }
  })
  const v2RightState = createMemo<TitlebarV2RightState>(() => ({
    update: updateState(),
  }))

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
      classList={{
        "shrink-0 relative overflow-hidden flex flex-row": true,
        "h-9 bg-v2-background-bg-deep": useV2Titlebar(),
        "h-10 bg-background-base": !useV2Titlebar(),
      }}
      style={{
        "min-height": minHeight(),
        "padding-left": mac() ? `${84 / zoom()}px` : 0,
        width: electronWindows() ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))` : undefined,
        "max-width": electronWindows()
          ? `env(titlebar-area-width, calc(100vw - ${windowsControlsWidth()}))`
          : undefined,
        "align-self": electronWindows() ? "flex-start" : undefined,
      }}
      data-tauri-drag-region
      onMouseDown={drag}
      onDblClick={maximize}
    >
      <Switch>
        <Match when={useV2Titlebar()}>
          {(_) => {
            const serverSync = useServerSync()
            const navigate = useNavigate()
            const homeMatch = useMatch(() => "/")

            const newSessionHref = () => {
              if (params.dir) return `/${params.dir}/session`

              const project = layout.projects.list()[0]
              if (!project) return "/"

              return `/${base64Encode(project.worktree)}/session`
            }

            type Tab = { dir: string; sessionId: string; href: string }

            const [tabsStore, tabsStoreActions] = iife(() => {
              const [store, setStore] = createStore<Tab[]>(
                iife(() => {
                  if (!params.dir || !params.id) return []
                  return [
                    {
                      dir: decodeDirectory(params.dir) ?? "",
                      sessionId: params.id,
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
                  void startTransition(() => {
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
                removeSessions: (input: SessionTabsRemovedDetail) => {
                  void startTransition(() => {
                    setStore(
                      produce((tabs) => {
                        const sessionIDs = new Set(input.sessionIDs)
                        const currentHref = params.dir && params.id ? makeSessionHref(params.dir, params.id) : undefined
                        const currentIndex = currentHref ? tabs.findIndex((tab) => tab.href === currentHref) : -1
                        const removedCurrent =
                          currentIndex !== -1 &&
                          tabs[currentIndex]?.dir === input.directory &&
                          sessionIDs.has(tabs[currentIndex]?.sessionId ?? "")

                        for (let i = tabs.length - 1; i >= 0; i--) {
                          const tab = tabs[i]
                          if (!tab) continue
                          if (tab.dir !== input.directory) continue
                          if (!sessionIDs.has(tab.sessionId)) continue
                          tabs.splice(i, 1)
                        }

                        if (!removedCurrent) return
                        const nextTab = tabs[currentIndex] ?? tabs[tabs.length - 1]
                        if (nextTab) navigate(nextTab.href)
                        else navigate("/")
                      }),
                    )
                  })
                },
              }

              return [store, actions]
            })

            makeEventListener(window, SESSION_TABS_REMOVED_EVENT, (event) => {
              const detail = readSessionTabsRemovedDetail(event)
              if (!detail) return
              tabsStoreActions.removeSessions(detail)
            })

            createEffect(() => {
              const params = useParams()
              if (!(params.dir && params.id)) return

              tabsStoreActions.addTab({
                dir: decodeDirectory(params.dir) ?? "",
                sessionId: params.id,
                href: makeSessionHref(params.dir, params.id),
              })
            })

            const projects = createMemo(() => layout.projects.list())
            const projectByID = createMemo(
              () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
            )

            const currentSessionTab = () => {
              if (!params.dir || !params.id) return
              const href = makeSessionHref(params.dir, params.id)
              return tabsStore.find((tab) => tab.href === href)
            }

            const closeCurrentSessionTab = () => {
              const tab = currentSessionTab()
              if (!tab) return false
              tabsStoreActions.removeTab(tab.href)
              return true
            }

            const closeNewSessionTab = () => {
              if (!(params.dir && !params.id)) return false
              const last = tabsStore[tabsStore.length - 1]
              if (last) navigate(last.href)
              else navigate("/")
              return true
            }

            const openNewTab = () => navigate(newSessionHref())

            const closeActiveTab = () => closeCurrentSessionTab() || closeNewSessionTab()

            command.register(() => {
              const commands = [
                {
                  id: "tab.new",
                  category: "tab",
                  title: language.t("command.session.new"),
                  keybind: "mod+t",
                  hidden: true,
                  onSelect: openNewTab,
                },
                {
                  id: "tab.close",
                  category: "tab",
                  title: language.t("command.tab.close"),
                  keybind: "mod+w",
                  hidden: true,
                  onSelect: closeActiveTab,
                },
                {
                  id: `tab.prev`,
                  category: "tab",
                  title: "",
                  keybind: `mod+option+ArrowLeft`,
                  hidden: true,
                  onSelect: () => {
                    let index = tabsStore.findIndex((tab) => tab.href === currentSessionTab()?.href)
                    if (index === -1) return

                    index -= 1
                    if (index === -1) index = tabsStore.length - 1

                    const next = tabsStore[index]
                    if (next) navigate(next.href)
                  },
                },
                {
                  id: `tab.next`,
                  category: "tab",
                  title: "",
                  keybind: `mod+option+ArrowRight`,
                  hidden: true,
                  onSelect: () => {
                    let index = tabsStore.findIndex((tab) => tab.href === currentSessionTab()?.href)
                    if (index === -1) return

                    index += 1
                    if (index === tabsStore.length) index = 0

                    const next = tabsStore[index]
                    if (next) navigate(next.href)
                  },
                },
                ...Array.from({ length: 9 }, (_, i) => {
                  const index = i
                  const number = index + 1
                  return {
                    id: `tab.${number}`,
                    category: "tab",
                    title: "",
                    keybind: `mod+${number}`,
                    disabled: layout.projects.list().length <= index,
                    hidden: true,
                    onSelect: () => {
                      const tab = tabsStore[index]
                      if (tab) navigate(tab.href)
                    },
                  }
                }),
              ]

              return commands
            })

            const tabsEnriched = iife(() => {
              const base = mapArray(
                () => tabsStore,
                (tab) => {
                  const sync = serverSync.createDirSyncContext(tab.dir)
                  const session = sync.session.get(tab.sessionId)
                  return session ? { ...tab, info: session } : null
                },
              )

              return () => base().flatMap((s) => (s ? [s] : []))
            })

            return (
              <div
                class="h-full flex-1 flex flex-row items-center gap-1.5 pr-3 pt-2"
                classList={{
                  "pl-2": mac(),
                  "pl-4": !mac(),
                }}
              >
                <ChannelIndicator />
                <Show when={windows() || linux()}>
                  <WindowsAppMenu command={command} platform={platform} variant="v2" />
                </Show>
                <IconButtonV2
                  variant="ghost-muted"
                  size="large"
                  as="a"
                  href="/"
                  class="!w-9"
                  icon={<IconV2 name="grid-plus" />}
                  state={!!homeMatch() ? "pressed" : undefined}
                />

                <div class="flex min-w-0 flex-1 flex-row items-center gap-1.5 overflow-hidden">
                  <div class="flex min-w-0 flex-row items-center gap-1.5 overflow-hidden">
                    <For each={tabsEnriched()}>
                      {(tab, i) => (
                        <>
                          {i() !== 0 && (
                            <div class="w-[1.5px] h-3 shrink-0 rounded-full bg-[var(--v2-background-bg-layer-02)]" />
                          )}
                          <TabNavItem
                            href={tab.href}
                            title={tab.info.title}
                            project={projectForSession(tab.info, projects(), projectByID())}
                            directory={tab.dir}
                            sessionId={tab.info.id}
                            onClose={() => tabsStoreActions.removeTab(tab.href)}
                          />
                        </>
                      )}
                    </For>
                  </div>
                  <Show
                    when={creating() && params.dir}
                    fallback={
                      <IconButtonV2
                        type="button"
                        variant="ghost-muted"
                        size="large"
                        class="shrink-0"
                        icon={<IconV2 name="plus" />}
                        as="a"
                        href={newSessionHref()}
                        aria-label={language.t("command.session.new")}
                      />
                    }
                  >
                    <NewSessionTabItem
                      href={`/${params.dir}/session`}
                      title={language.t("command.session.new")}
                      onClose={() => navigate(tabsEnriched().at(-1)?.href ?? "/")}
                    />
                  </Show>
                  <div class="min-w-0 flex-1" />
                </div>
                <TitlebarV2Right state={v2RightState()} />
                <Show when={windows() && !electronWindows()}>
                  <div data-tauri-decorum-tb class="flex flex-row" />
                </Show>
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
                {/*<div class="h-full shrink-0" style={{ width: `${72 / zoom()}px` }} />*/}
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

type TitlebarUpdatePillState = {
  visible: boolean
  installing: boolean
  label: string
  ariaLabel: string
  title?: string
  onInstall: () => void
}

type TitlebarV2RightState = {
  update: TitlebarUpdatePillState
}

function TitlebarV2Right(props: { state: TitlebarV2RightState }) {
  return (
    <div class="flex shrink-0 items-center justify-end gap-0">
      <TitlebarUpdatePill state={props.state.update} />
      <div id="opencode-titlebar-right" class="flex shrink-0 items-center justify-end gap-0" />
    </div>
  )
}

function TitlebarUpdatePill(props: { state: TitlebarUpdatePillState }) {
  return (
    <Show when={props.state.visible}>
      <button
        type="button"
        class="h-5 shrink-0 rounded-[27px] bg-[var(--v2-background-bg-layer-03)] px-2.5 text-[11px] font-[530] leading-4 tracking-[0.05px] text-[var(--v2-text-text-base)] disabled:opacity-60"
        onClick={props.state.onInstall}
        disabled={props.state.installing}
        aria-label={props.state.ariaLabel}
        title={props.state.title}
      >
        {props.state.label}
      </button>
    </Show>
  )
}

function TabNavItem(props: {
  href: string
  title: string
  project?: LocalProject
  directory: string
  sessionId: string
  hideClose?: boolean
  onClose: () => void
}) {
  const match = useMatch(() => props.href)
  const isActive = () => !!match()
  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }
  return (
    <div
      class="group relative flex h-7 min-w-24 max-w-60 flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] bg-[var(--tab-bg)] px-1.5 [--tab-bg:var(--v2-background-bg-deep)] hover:[--tab-bg:var(--v2-background-bg-layer-02)] data-[active='true']:[--tab-bg:var(--v2-background-bg-layer-02)]"
      data-active={isActive()}
      onMouseDown={(event) => {
        if (event.button !== 1) return
        closeTab(event)
      }}
    >
      <a
        href={props.href}
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base"
      >
        <span data-slot="project-avatar-slot">
          <ProjectTabAvatar project={props.project} directory={props.directory} sessionId={props.sessionId} />
        </span>
        <span class="min-w-0 flex-1">{props.title}</span>
      </a>

      <div class="absolute not-group-hover:not-group-data-[active=true]:left-52 group-hover:right-0 group-data-[active=true]:right-0 inset-y-0 flex flex-row items-center pr-1 py-1 w-8 pl-2">
        <div
          class="absolute inset-0 rounded-r-[6px] bg-(image:--inactive-bg) group-hover:bg-(image:--active-bg) group-data-[active=true]:bg-(image:--active-bg)"
          style={{
            "--inactive-bg": "linear-gradient(to right, transparent 0%, var(--tab-bg) 80%)",
            "--active-bg": "linear-gradient(90deg, transparent 0%, var(--tab-bg) 25%)",
          }}
        />
        <IconButtonV2
          size="small"
          variant="ghost-muted"
          class="opacity-0 group-hover:opacity-100 group-data-[active='true']:opacity-100 z-10"
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
        />
      </div>
    </div>
  )
}

function ProjectTabAvatar(props: { project?: LocalProject; directory: string; sessionId: string }) {
  const directory = () => props.directory
  const sessionId = () => props.sessionId
  const state = useSessionTabAvatarState(directory, sessionId)
  return (
    <ProjectAvatar
      fallback={displayName(props.project ?? { worktree: props.directory })}
      src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
      variant={getProjectAvatarVariant(props.project?.icon?.color)}
      unread={state.unread()}
      loading={state.loading()}
    />
  )
}

function NewSessionTabItem(props: { href: string; title: string; onClose: () => void }) {
  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }
  return (
    <div
      class="group relative flex h-7 max-w-60 flex-row items-center gap-1.5 overflow-hidden rounded-[6px] bg-[var(--v2-overlay-simple-overlay-pressed)] pl-1.5 pr-8 whitespace-nowrap focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--v2-border-border-focus)]"
      onMouseDown={(event) => {
        if (event.button !== 1) return
        closeTab(event)
      }}
    >
      <a
        href={props.href}
        aria-current="page"
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 overflow-hidden text-[13px] font-medium leading-5 text-[var(--v2-text-text-base)]"
      >
        <span class="flex size-4 shrink-0 rotate-90 items-center justify-center">
          <IconV2 name="edit" />
        </span>
        <span class="truncate leading-5">{props.title}</span>
      </a>
      <div class="absolute right-0 inset-y-0 flex w-7 items-center justify-center">
        <IconButtonV2
          size="small"
          variant="ghost-muted"
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={closeTab}
          icon={<IconV2 name="xmark-small" />}
          aria-label="Close tab"
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
