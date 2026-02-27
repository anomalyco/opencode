import { AppIcon } from "@opencode-ai/ui/app-icon"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Keybind } from "@opencode-ai/ui/keybind"
import { Popover } from "@opencode-ai/ui/popover"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/util/path"
import { useParams } from "@solidjs/router"
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { decode64 } from "@/utils/base64"
import { Persist, persisted } from "@/utils/persist"
import { StatusPopover } from "../status-popover"

const OPEN_APPS = [
  "vscode",
  "cursor",
  "zed",
  "textmate",
  "antigravity",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "warp",
  "xcode",
  "android-studio",
  "powershell",
  "sublime-text",
] as const

type OpenApp = (typeof OPEN_APPS)[number]
type OS = "macos" | "windows" | "linux" | "unknown"

const MAC_APPS = [
  {
    id: "vscode",
    label: "VS Code",
    icon: "vscode",
    openWith: "Visual Studio Code",
  },
  { id: "cursor", label: "Cursor", icon: "cursor", openWith: "Cursor" },
  { id: "zed", label: "Zed", icon: "zed", openWith: "Zed" },
  { id: "textmate", label: "TextMate", icon: "textmate", openWith: "TextMate" },
  {
    id: "antigravity",
    label: "Antigravity",
    icon: "antigravity",
    openWith: "Antigravity",
  },
  { id: "terminal", label: "Terminal", icon: "terminal", openWith: "Terminal" },
  { id: "iterm2", label: "iTerm2", icon: "iterm2", openWith: "iTerm" },
  { id: "ghostty", label: "Ghostty", icon: "ghostty", openWith: "Ghostty" },
  { id: "warp", label: "Warp", icon: "warp", openWith: "Warp" },
  { id: "xcode", label: "Xcode", icon: "xcode", openWith: "Xcode" },
  {
    id: "android-studio",
    label: "Android Studio",
    icon: "android-studio",
    openWith: "Android Studio",
  },
  {
    id: "sublime-text",
    label: "Sublime Text",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const WINDOWS_APPS = [
  { id: "vscode", label: "VS Code", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "Cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "Zed", icon: "zed", openWith: "zed" },
  {
    id: "powershell",
    label: "PowerShell",
    icon: "powershell",
    openWith: "powershell",
  },
  {
    id: "sublime-text",
    label: "Sublime Text",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const LINUX_APPS = [
  { id: "vscode", label: "VS Code", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "Cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "Zed", icon: "zed", openWith: "zed" },
  {
    id: "sublime-text",
    label: "Sublime Text",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

type OpenOption = (typeof MAC_APPS)[number] | (typeof WINDOWS_APPS)[number] | (typeof LINUX_APPS)[number]
type OpenIcon = OpenApp | "file-explorer"
const OPEN_ICON_BASE = new Set<OpenIcon>(["finder", "vscode", "cursor", "zed"])

const openIconSize = (id: OpenIcon) => (OPEN_ICON_BASE.has(id) ? "size-4" : "size-[19px]")

const detectOS = (platform: ReturnType<typeof usePlatform>): OS => {
  if (platform.platform === "desktop" && platform.os) return platform.os
  if (typeof navigator !== "object") return "unknown"
  const value = navigator.platform || navigator.userAgent
  if (/Mac/i.test(value)) return "macos"
  if (/Win/i.test(value)) return "windows"
  if (/Linux/i.test(value)) return "linux"
  return "unknown"
}

const showRequestError = (language: ReturnType<typeof useLanguage>, err: unknown) => {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

function useSessionShare(args: {
  globalSDK: ReturnType<typeof useGlobalSDK>
  currentSession: () =>
    | {
        id: string
        share?: {
          url?: string
        }
      }
    | undefined
  projectDirectory: () => string
  platform: ReturnType<typeof usePlatform>
}) {
  const [state, setState] = createStore({
    share: false,
    unshare: false,
    copied: false,
    timer: undefined as number | undefined,
  })
  const shareUrl = createMemo(() => args.currentSession()?.share?.url)

  createEffect(() => {
    const url = shareUrl()
    if (url) return
    if (state.timer) window.clearTimeout(state.timer)
    setState({ copied: false, timer: undefined })
  })

  onCleanup(() => {
    if (state.timer) window.clearTimeout(state.timer)
  })

  const shareSession = () => {
    const session = args.currentSession()
    if (!session || state.share) return
    setState("share", true)
    args.globalSDK.client.session
      .share({ sessionID: session.id, directory: args.projectDirectory() })
      .catch((error) => {
        console.error("Failed to share session", error)
      })
      .finally(() => {
        setState("share", false)
      })
  }

  const unshareSession = () => {
    const session = args.currentSession()
    if (!session || state.unshare) return
    setState("unshare", true)
    args.globalSDK.client.session
      .unshare({ sessionID: session.id, directory: args.projectDirectory() })
      .catch((error) => {
        console.error("Failed to unshare session", error)
      })
      .finally(() => {
        setState("unshare", false)
      })
  }

  const copyLink = (onError: (error: unknown) => void) => {
    const url = shareUrl()
    if (!url) return
    navigator.clipboard
      .writeText(url)
      .then(() => {
        if (state.timer) window.clearTimeout(state.timer)
        setState("copied", true)
        const timer = window.setTimeout(() => {
          setState("copied", false)
          setState("timer", undefined)
        }, 3000)
        setState("timer", timer)
      })
      .catch(onError)
  }

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    args.platform.openLink(url)
  }

  return { state, shareUrl, shareSession, unshareSession, copyLink, viewShare }
}

export function SessionHeader() {
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const params = useParams()
  const command = useCommand()
  const server = useServer()
  const sync = useSync()
  const platform = usePlatform()
  const language = useLanguage()

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybind("file.open"))

  const currentSession = createMemo(() => sync.data.session.find((s) => s.id === params.id))
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const showShare = createMemo(() => shareEnabled() && !!currentSession())
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey))
  const os = createMemo(() => detectOS(platform))

  const [exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({
    finder: true,
  })

  const apps = createMemo(() => {
    if (os() === "macos") return MAC_APPS
    if (os() === "windows") return WINDOWS_APPS
    return LINUX_APPS
  })

  const fileManager = createMemo(() => {
    if (os() === "macos") return { label: "Finder", icon: "finder" as const }
    if (os() === "windows") return { label: "File Explorer", icon: "file-explorer" as const }
    return { label: "File Manager", icon: "finder" as const }
  })

  createEffect(() => {
    if (platform.platform !== "desktop") return
    if (!platform.checkAppExists) return

    const list = apps()

    setExists(Object.fromEntries(list.map((app) => [app.id, undefined])) as Partial<Record<OpenApp, boolean>>)

    void Promise.all(
      list.map((app) =>
        Promise.resolve(platform.checkAppExists?.(app.openWith))
          .then((value) => Boolean(value))
          .catch(() => false)
          .then((ok) => {
            console.debug(`[session-header] App "${app.label}" (${app.openWith}): ${ok ? "exists" : "does not exist"}`)
            return [app.id, ok] as const
          }),
      ),
    ).then((entries) => {
      setExists(Object.fromEntries(entries) as Partial<Record<OpenApp, boolean>>)
    })
  })

  const options = createMemo(() => {
    return [
      { id: "finder", label: fileManager().label, icon: fileManager().icon },
      ...apps().filter((app) => exists[app.id]),
    ] as const
  })

  const [prefs, setPrefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))
  const [menu, setMenu] = createStore({ open: false })
  const [openRequest, setOpenRequest] = createStore({
    app: undefined as OpenApp | undefined,
  })

  const canOpen = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())
  const current = createMemo(() => options().find((o) => o.id === prefs.app) ?? options()[0])
  const opening = createMemo(() => openRequest.app !== undefined)

  createEffect(() => {
    const value = prefs.app
    if (options().some((o) => o.id === value)) return
    setPrefs("app", options()[0]?.id ?? "finder")
  })

  const openDir = (app: OpenApp) => {
    if (opening() || !canOpen() || !platform.openPath) return
    const directory = projectDirectory()
    if (!directory) return

    const item = options().find((o) => o.id === app)
    const openWith = item && "openWith" in item ? item.openWith : undefined
    setOpenRequest("app", app)
    platform
      .openPath(directory, openWith)
      .catch((err: unknown) => showRequestError(language, err))
      .finally(() => {
        setOpenRequest("app", undefined)
      })
  }

  const copyPath = () => {
    const directory = projectDirectory()
    if (!directory) return
    navigator.clipboard
      .writeText(directory)
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: directory,
        })
      })
      .catch((err: unknown) => showRequestError(language, err))
  }

  const share = useSessionShare({
    globalSDK,
    currentSession,
    projectDirectory,
    platform,
  })

  const centerMount = createMemo(() => document.getElementById("opencode-titlebar-center"))
  const rightMount = createMemo(() => document.getElementById("opencode-titlebar-right"))

  return (
    <>
      <Show when={centerMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              class="hidden md:flex w-[240px] max-w-full min-w-0 pl-0.5 pr-2 items-center gap-2 justify-between rounded-md border border-border-weak-base bg-surface-panel shadow-none cursor-default"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
            >
              <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-visible">
                <Icon name="magnifying-glass" size="small" class="icon-base shrink-0 size-4" />
                <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
                  {language.t("session.header.search.placeholder", {
                    project: name(),
                  })}
                </span>
              </div>

              <Show when={hotkey()}>
                {(keybind) => (
                  <Keybind class="shrink-0 !border-0 !bg-transparent !shadow-none px-0">{keybind()}</Keybind>
                )}
              </Show>
            </Button>
          </Portal>
        )}
      </Show>
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center gap-2">
              <StatusPopover />
              <Show when={projectDirectory()}>
                <div class="hidden xl:flex items-center">
                  <Show
                    when={canOpen()}
                    fallback={
                      <div class="flex h-[24px] box-border items-center rounded-md border border-border-weak-base bg-surface-panel overflow-hidden">
                        <Button
                          variant="ghost"
                          class="rounded-none h-full py-0 pr-3 pl-0.5 gap-1.5 border-none shadow-none"
                          onClick={copyPath}
                          aria-label={language.t("session.header.open.copyPath")}
                        >
                          <Icon name="copy" size="small" class="text-icon-base" />
                          <span class="text-12-regular text-text-strong">
                            {language.t("session.header.open.copyPath")}
                          </span>
                        </Button>
                      </div>
                    }
                  >
                    <div class="flex items-center">
                      <div class="flex h-[24px] box-border items-center rounded-md border border-border-weak-base bg-surface-panel overflow-hidden">
                        <Button
                          variant="ghost"
                          class="rounded-none h-full py-0 pr-3 pl-0.5 gap-1.5 border-none shadow-none disabled:!cursor-default"
                          classList={{
                            "bg-surface-raised-base-active": opening(),
                          }}
                          onClick={() => openDir(current().id)}
                          disabled={opening()}
                          aria-label={language.t("session.header.open.ariaLabel", { app: current().label })}
                        >
                          <div class="flex size-5 shrink-0 items-center justify-center">
                            <Show
                              when={opening()}
                              fallback={<AppIcon id={current().icon} class={openIconSize(current().icon)} />}
                            >
                              <Spinner class="size-3.5 text-icon-base" />
                            </Show>
                          </div>
                          <span class="text-12-regular text-text-strong">Open</span>
                        </Button>
                        <div class="self-stretch w-px bg-border-weak-base" />
                        <DropdownMenu
                          gutter={4}
                          placement="bottom-end"
                          open={menu.open}
                          onOpenChange={(open) => setMenu("open", open)}
                        >
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="chevron-down"
                            variant="ghost"
                            disabled={opening()}
                            class="rounded-none h-full w-[24px] p-0 border-none shadow-none data-[expanded]:bg-surface-raised-base-active disabled:!cursor-default"
                            classList={{
                              "bg-surface-raised-base-active": opening(),
                            }}
                            aria-label={language.t("session.header.open.menu")}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content>
                              <DropdownMenu.Group>
                                <DropdownMenu.GroupLabel>{language.t("session.header.openIn")}</DropdownMenu.GroupLabel>
                                <DropdownMenu.RadioGroup
                                  value={current().id}
                                  onChange={(value) => {
                                    if (!OPEN_APPS.includes(value as OpenApp)) return
                                    setPrefs("app", value as OpenApp)
                                  }}
                                >
                                  <For each={options()}>
                                    {(o) => (
                                      <DropdownMenu.RadioItem
                                        value={o.id}
                                        disabled={opening()}
                                        onSelect={() => {
                                          setMenu("open", false)
                                          openDir(o.id)
                                        }}
                                      >
                                        <div class="flex size-5 shrink-0 items-center justify-center">
                                          <AppIcon id={o.icon} class={openIconSize(o.icon)} />
                                        </div>
                                        <DropdownMenu.ItemLabel>{o.label}</DropdownMenu.ItemLabel>
                                        <DropdownMenu.ItemIndicator>
                                          <Icon name="check-small" size="small" class="text-icon-weak" />
                                        </DropdownMenu.ItemIndicator>
                                      </DropdownMenu.RadioItem>
                                    )}
                                  </For>
                                </DropdownMenu.RadioGroup>
                              </DropdownMenu.Group>
                              <DropdownMenu.Separator />
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setMenu("open", false)
                                  copyPath()
                                }}
                              >
                                <div class="flex size-5 shrink-0 items-center justify-center">
                                  <Icon name="copy" size="small" class="text-icon-weak" />
                                </div>
                                <DropdownMenu.ItemLabel>
                                  {language.t("session.header.open.copyPath")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
              <Show when={showShare()}>
                <div class="flex items-center">
                  <Popover
                    title={language.t("session.share.popover.title")}
                    description={
                      share.shareUrl()
                        ? language.t("session.share.popover.description.shared")
                        : language.t("session.share.popover.description.unshared")
                    }
                    gutter={4}
                    placement="bottom-end"
                    shift={-64}
                    class="rounded-xl [&_[data-slot=popover-close-button]]:hidden"
                    triggerAs={Button}
                    triggerProps={{
                      variant: "ghost",
                      class:
                        "rounded-md h-[24px] px-3 border border-border-weak-base bg-surface-panel shadow-none data-[expanded]:bg-surface-base-active",
                      classList: {
                        "rounded-r-none": share.shareUrl() !== undefined,
                        "border-r-0": share.shareUrl() !== undefined,
                      },
                      style: { scale: 1 },
                    }}
                    trigger={<span class="text-12-regular">{language.t("session.share.action.share")}</span>}
                  >
                    <div class="flex flex-col gap-2">
                      <Show
                        when={share.shareUrl()}
                        fallback={
                          <div class="flex">
                            <Button
                              size="large"
                              variant="primary"
                              class="w-1/2"
                              onClick={share.shareSession}
                              disabled={share.state.share}
                            >
                              {share.state.share
                                ? language.t("session.share.action.publishing")
                                : language.t("session.share.action.publish")}
                            </Button>
                          </div>
                        }
                      >
                        <div class="flex flex-col gap-2">
                          <TextField
                            value={share.shareUrl() ?? ""}
                            readOnly
                            copyable
                            copyKind="link"
                            tabIndex={-1}
                            class="w-full"
                          />
                          <div class="grid grid-cols-2 gap-2">
                            <Button
                              size="large"
                              variant="secondary"
                              class="w-full shadow-none border border-border-weak-base"
                              onClick={share.unshareSession}
                              disabled={share.state.unshare}
                            >
                              {share.state.unshare
                                ? language.t("session.share.action.unpublishing")
                                : language.t("session.share.action.unpublish")}
                            </Button>
                            <Button
                              size="large"
                              variant="primary"
                              class="w-full"
                              onClick={share.viewShare}
                              disabled={share.state.unshare}
                            >
                              {language.t("session.share.action.view")}
                            </Button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Popover>
                  <Show when={share.shareUrl()} fallback={<div aria-hidden="true" />}>
                    <Tooltip
                      value={
                        share.state.copied
                          ? language.t("session.share.copy.copied")
                          : language.t("session.share.copy.copyLink")
                      }
                      placement="top"
                      gutter={8}
                    >
                      <IconButton
                        icon={share.state.copied ? "check" : "link"}
                        variant="ghost"
                        class="rounded-l-none h-[24px] border border-border-weak-base bg-surface-panel shadow-none"
                        onClick={() => share.copyLink((error) => showRequestError(language, error))}
                        disabled={share.state.unshare}
                        aria-label={
                          share.state.copied
                            ? language.t("session.share.copy.copied")
                            : language.t("session.share.copy.copyLink")
                        }
                      />
                    </Tooltip>
                  </Show>
                </div>
              </Show>
              <div class="flex items-center gap-1">
                <div class="hidden md:flex items-center gap-1 shrink-0">
                  <TooltipKeybind
                    title={language.t("command.terminal.toggle")}
                    keybind={command.keybind("terminal.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="group/terminal-toggle titlebar-icon w-8 h-6 p-0 box-border"
                      onClick={() => view().terminal.toggle()}
                      aria-label={language.t("command.terminal.toggle")}
                      aria-expanded={view().terminal.opened()}
                      aria-controls="terminal-panel"
                    >
                      <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                        <Icon
                          size="small"
                          name={view().terminal.opened() ? "layout-bottom-partial" : "layout-bottom"}
                          class="group-hover/terminal-toggle:hidden"
                        />
                        <Icon
                          size="small"
                          name="layout-bottom-partial"
                          class="hidden group-hover/terminal-toggle:inline-block"
                        />
                        <Icon
                          size="small"
                          name={view().terminal.opened() ? "layout-bottom" : "layout-bottom-partial"}
                          class="hidden group-active/terminal-toggle:inline-block"
                        />
                      </div>
                    </Button>
                  </TooltipKeybind>

                  <TooltipKeybind
                    title={language.t("command.review.toggle")}
                    keybind={command.keybind("review.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="group/review-toggle titlebar-icon w-8 h-6 p-0 box-border"
                      onClick={() => view().reviewPanel.toggle()}
                      aria-label={language.t("command.review.toggle")}
                      aria-expanded={view().reviewPanel.opened()}
                      aria-controls="review-panel"
                    >
                      <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                        <Icon
                          size="small"
                          name={view().reviewPanel.opened() ? "layout-right-partial" : "layout-right"}
                          class="group-hover/review-toggle:hidden"
                        />
                        <Icon
                          size="small"
                          name="layout-right-partial"
                          class="hidden group-hover/review-toggle:inline-block"
                        />
                        <Icon
                          size="small"
                          name={view().reviewPanel.opened() ? "layout-right" : "layout-right-partial"}
                          class="hidden group-active/review-toggle:inline-block"
                        />
                      </div>
                    </Button>
                  </TooltipKeybind>

                  <TooltipKeybind
                    title={language.t("command.fileTree.toggle")}
                    keybind={command.keybind("fileTree.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="titlebar-icon w-8 h-6 p-0 box-border"
                      onClick={() => layout.fileTree.toggle()}
                      aria-label={language.t("command.fileTree.toggle")}
                      aria-expanded={layout.fileTree.opened()}
                      aria-controls="file-tree-panel"
                    >
                      <div class="relative flex items-center justify-center size-4">
                        <Icon
                          size="small"
                          name={layout.fileTree.opened() ? "file-tree-active" : "file-tree"}
                          classList={{
                            "text-icon-strong": layout.fileTree.opened(),
                            "text-icon-weak": !layout.fileTree.opened(),
                          }}
                        />
                      </div>
                    </Button>
                  </TooltipKeybind>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
