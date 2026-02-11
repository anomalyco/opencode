import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useParams } from "@solidjs/router"
import { useLayout } from "@/context/layout"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { getFilename } from "@opencode-ai/util/path"
import { decode64 } from "@/utils/base64"
import { Persist, persisted } from "@/utils/persist"

import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { AppIcon } from "@opencode-ai/ui/app-icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Popover } from "@opencode-ai/ui/popover"
import { TextField } from "@opencode-ai/ui/text-field"
import { Keybind } from "@opencode-ai/ui/keybind"
import { showToast } from "@opencode-ai/ui/toast"
import { StatusPopover } from "../status-popover"

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
    "xcode",
    "android-studio",
    "powershell",
    "sublime-text",
  ] as const
  type OpenApp = (typeof OPEN_APPS)[number]

  const MAC_APPS = [
    { id: "vscode", label: "VS Code", icon: "vscode", openWith: "Visual Studio Code" },
    { id: "cursor", label: "Cursor", icon: "cursor", openWith: "Cursor" },
    { id: "zed", label: "Zed", icon: "zed", openWith: "Zed" },
    { id: "textmate", label: "TextMate", icon: "textmate", openWith: "TextMate" },
    { id: "antigravity", label: "Antigravity", icon: "antigravity", openWith: "Antigravity" },
    { id: "terminal", label: "Terminal", icon: "terminal", openWith: "Terminal" },
    { id: "iterm2", label: "iTerm2", icon: "iterm2", openWith: "iTerm" },
    { id: "ghostty", label: "Ghostty", icon: "ghostty", openWith: "Ghostty" },
    { id: "xcode", label: "Xcode", icon: "xcode", openWith: "Xcode" },
    { id: "android-studio", label: "Android Studio", icon: "android-studio", openWith: "Android Studio" },
    { id: "sublime-text", label: "Sublime Text", icon: "sublime-text", openWith: "Sublime Text" },
  ] as const

  const WINDOWS_APPS = [
    { id: "vscode", label: "VS Code", icon: "vscode", openWith: "code" },
    { id: "cursor", label: "Cursor", icon: "cursor", openWith: "cursor" },
    { id: "zed", label: "Zed", icon: "zed", openWith: "zed" },
    { id: "powershell", label: "PowerShell", icon: "powershell", openWith: "powershell" },
    { id: "sublime-text", label: "Sublime Text", icon: "sublime-text", openWith: "Sublime Text" },
  ] as const

  const LINUX_APPS = [
    { id: "vscode", label: "VS Code", icon: "vscode", openWith: "code" },
    { id: "cursor", label: "Cursor", icon: "cursor", openWith: "cursor" },
    { id: "zed", label: "Zed", icon: "zed", openWith: "zed" },
    { id: "sublime-text", label: "Sublime Text", icon: "sublime-text", openWith: "Sublime Text" },
  ] as const

  const os = createMemo<"macos" | "windows" | "linux" | "unknown">(() => {
    if (platform.platform === "desktop" && platform.os) return platform.os
    if (typeof navigator !== "object") return "unknown"
    const value = navigator.platform || navigator.userAgent
    if (/Mac/i.test(value)) return "macos"
    if (/Win/i.test(value)) return "windows"
    if (/Linux/i.test(value)) return "linux"
    return "unknown"
  })

  const [exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({ finder: true })

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

  type OpenIcon = OpenApp | "file-explorer"
  const base = new Set<OpenIcon>(["finder", "vscode", "cursor", "zed"])
  const size = (id: OpenIcon) => (base.has(id) ? "size-4" : "size-[19px]")

  const checksReady = createMemo(() => {
    if (platform.platform !== "desktop") return true
    if (!platform.checkAppExists) return true
    const list = apps()
    return list.every((app) => exists[app.id] !== undefined)
  })

  const [prefs, setPrefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))
  const [menu, setMenu] = createStore({ open: false })

  const canOpen = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())
  const current = createMemo(() => options().find((o) => o.id === prefs.app) ?? options()[0])

  createEffect(() => {
    if (platform.platform !== "desktop") return
    if (!checksReady()) return
    const value = prefs.app
    if (options().some((o) => o.id === value)) return
    setPrefs("app", options()[0]?.id ?? "finder")
  })

  const openDir = (app: OpenApp) => {
    const directory = projectDirectory()
    if (!directory) return
    if (!canOpen()) return

    const item = options().find((o) => o.id === app)
    const openWith = item && "openWith" in item ? item.openWith : undefined
    Promise.resolve(platform.openPath?.(directory, openWith)).catch((err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
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
      .catch((err: unknown) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
  }

  const [state, setState] = createStore({
    share: false,
    unshare: false,
    copied: false,
    timer: undefined as number | undefined,
  })
  const shareUrl = createMemo(() => currentSession()?.share?.url)

  createEffect(() => {
    const url = shareUrl()
    if (url) return
    if (state.timer) window.clearTimeout(state.timer)
    setState({ copied: false, timer: undefined })
  })

  onCleanup(() => {
    if (state.timer) window.clearTimeout(state.timer)
  })

  function shareSession() {
    const session = currentSession()
    if (!session || state.share) return
    setState("share", true)
    globalSDK.client.session
      .share({ sessionID: session.id, directory: projectDirectory() })
      .catch((error) => {
        console.error("Failed to share session", error)
      })
      .finally(() => {
        setState("share", false)
      })
  }

  function unshareSession() {
    const session = currentSession()
    if (!session || state.unshare) return
    setState("unshare", true)
    globalSDK.client.session
      .unshare({ sessionID: session.id, directory: projectDirectory() })
      .catch((error) => {
        console.error("Failed to unshare session", error)
      })
      .finally(() => {
        setState("unshare", false)
      })
  }

  function copyLink() {
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
      .catch((error) => {
        console.error("Failed to copy share link", error)
      })
  }

  function viewShare() {
    const url = shareUrl()
    if (!url) return
    platform.openLink(url)
  }

  const centerMount = createMemo(() => document.getElementById("opencode-titlebar-center"))
  const rightMount = createMemo(() => document.getElementById("opencode-titlebar-right"))

  return (
    <>
      <Show when={centerMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <button
              type="button"
              class="hidden md:flex w-[320px] max-w-full min-w-0 h-[24px] px-2 pl-1.5 items-center gap-2 justify-between rounded-md border border-border-base bg-surface-panel transition-colors cursor-default hover:bg-surface-raised-base-hover focus-visible:bg-surface-raised-base-hover active:bg-surface-raised-base-active"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
            >
              <div class="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
                <Icon name="magnifying-glass" size="normal" class="icon-base shrink-0" />
                <span class="flex-1 min-w-0 text-14-regular text-text-weak truncate h-4.5 flex items-center">
                  {language.t("session.header.search.placeholder", { project: name() })}
                </span>
              </div>

              <Show when={hotkey()}>
                {(keybind) => (
                  <Keybind class="shrink-0 !border-0 !bg-transparent !shadow-none px-0">{keybind()}</Keybind>
                )}
              </Show>
            </button>
          </Portal>
        )}
      </Show>
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center gap-3">
              <StatusPopover />
              <Show when={projectDirectory()}>
                <div class="hidden xl:flex items-center">
                  <Show
                    when={canOpen()}
                    fallback={
                      <div class="flex h-[24px] box-border items-center rounded-md border border-border-base bg-surface-panel overflow-hidden">
                        <Button
                          variant="ghost"
                          class="rounded-none h-full py-0 pr-3 pl-2 gap-2 border-none shadow-none"
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
                      <div class="flex h-[24px] box-border items-center rounded-md border border-border-base bg-surface-panel overflow-hidden">
                        <Button
                          variant="ghost"
                          class="rounded-none h-full py-0 pr-3 pl-2 gap-1.5 border-none shadow-none"
                          onClick={() => openDir(current().id)}
                          aria-label={language.t("session.header.open.ariaLabel", { app: current().label })}
                        >
                          <div class="flex size-5 shrink-0 items-center justify-center">
                            <AppIcon id={current().icon} class="size-4" />
                          </div>
                          <span class="text-12-regular text-text-strong">Open</span>
                        </Button>
                        <div class="self-stretch w-px bg-border-base/70" />
                        <DropdownMenu
                          gutter={6}
                          placement="bottom-end"
                          open={menu.open}
                          onOpenChange={(open) => setMenu("open", open)}
                        >
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="chevron-down"
                            variant="ghost"
                            class="rounded-none h-full w-[24px] p-0 border-none shadow-none data-[expanded]:bg-surface-raised-base-active"
                            aria-label={language.t("session.header.open.menu")}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content>
                              <DropdownMenu.Group>
                                <DropdownMenu.GroupLabel>{language.t("session.header.openIn")}</DropdownMenu.GroupLabel>
                                <DropdownMenu.RadioGroup
                                  value={prefs.app}
                                  onChange={(value) => {
                                    if (!OPEN_APPS.includes(value as OpenApp)) return
                                    setPrefs("app", value as OpenApp)
                                  }}
                                >
                                  {options().map((o) => (
                                    <DropdownMenu.RadioItem
                                      value={o.id}
                                      onSelect={() => {
                                        setMenu("open", false)
                                        openDir(o.id)
                                      }}
                                    >
                                      <div class="flex size-5 shrink-0 items-center justify-center">
                                        <AppIcon id={o.icon} class={size(o.icon)} />
                                      </div>
                                      <DropdownMenu.ItemLabel>{o.label}</DropdownMenu.ItemLabel>
                                      <DropdownMenu.ItemIndicator>
                                        <Icon name="check-small" size="small" class="text-icon-weak" />
                                      </DropdownMenu.ItemIndicator>
                                    </DropdownMenu.RadioItem>
                                  ))}
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
                      shareUrl()
                        ? language.t("session.share.popover.description.shared")
                        : language.t("session.share.popover.description.unshared")
                    }
                    gutter={6}
                    placement="bottom-end"
                    shift={-64}
                    class="rounded-xl [&_[data-slot=popover-close-button]]:hidden"
                    triggerAs={Button}
                    triggerProps={{
                      variant: "ghost",
                      class:
                        "rounded-md h-[24px] px-3 border border-border-base bg-surface-panel shadow-none data-[expanded]:bg-surface-raised-base-active",
                      classList: { "rounded-r-none": shareUrl() !== undefined },
                      style: { scale: 1 },
                    }}
                    trigger={language.t("session.share.action.share")}
                  >
                    <div class="flex flex-col gap-2">
                      <Show
                        when={shareUrl()}
                        fallback={
                          <div class="flex">
                            <Button
                              size="large"
                              variant="primary"
                              class="w-1/2"
                              onClick={shareSession}
                              disabled={state.share}
                            >
                              {state.share
                                ? language.t("session.share.action.publishing")
                                : language.t("session.share.action.publish")}
                            </Button>
                          </div>
                        }
                      >
                        <div class="flex flex-col gap-2">
                          <TextField
                            value={shareUrl() ?? ""}
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
                              onClick={unshareSession}
                              disabled={state.unshare}
                            >
                              {state.unshare
                                ? language.t("session.share.action.unpublishing")
                                : language.t("session.share.action.unpublish")}
                            </Button>
                            <Button
                              size="large"
                              variant="primary"
                              class="w-full"
                              onClick={viewShare}
                              disabled={state.unshare}
                            >
                              {language.t("session.share.action.view")}
                            </Button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Popover>
                  <Show when={shareUrl()} fallback={<div aria-hidden="true" />}>
                    <Tooltip
                      value={
                        state.copied
                          ? language.t("session.share.copy.copied")
                          : language.t("session.share.copy.copyLink")
                      }
                      placement="top"
                      gutter={8}
                    >
                      <IconButton
                        icon={state.copied ? "check" : "link"}
                        variant="ghost"
                        class="rounded-l-none h-[24px] border border-border-base bg-surface-panel shadow-none"
                        onClick={copyLink}
                        disabled={state.unshare}
                        aria-label={
                          state.copied
                            ? language.t("session.share.copy.copied")
                            : language.t("session.share.copy.copyLink")
                        }
                      />
                    </Tooltip>
                  </Show>
                </div>
              </Show>
              <div class="hidden md:flex items-center gap-3 ml-2 shrink-0">
                <TooltipKeybind
                  title={language.t("command.terminal.toggle")}
                  keybind={command.keybind("terminal.toggle")}
                >
                  <Button
                    variant="ghost"
                    class="group/terminal-toggle size-6 p-0"
                    onClick={() => view().terminal.toggle()}
                    aria-label={language.t("command.terminal.toggle")}
                    aria-expanded={view().terminal.opened()}
                    aria-controls="terminal-panel"
                  >
                    <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                      <Icon
                        size="small"
                        name={view().terminal.opened() ? "layout-bottom-full" : "layout-bottom"}
                        class="group-hover/terminal-toggle:hidden"
                      />
                      <Icon
                        size="small"
                        name="layout-bottom-partial"
                        class="hidden group-hover/terminal-toggle:inline-block"
                      />
                      <Icon
                        size="small"
                        name={view().terminal.opened() ? "layout-bottom" : "layout-bottom-full"}
                        class="hidden group-active/terminal-toggle:inline-block"
                      />
                    </div>
                  </Button>
                </TooltipKeybind>
              </div>
              <div class="hidden md:block shrink-0">
                <TooltipKeybind title={language.t("command.review.toggle")} keybind={command.keybind("review.toggle")}>
                  <Button
                    variant="ghost"
                    class="group/review-toggle size-6 p-0"
                    onClick={() => view().reviewPanel.toggle()}
                    aria-label={language.t("command.review.toggle")}
                    aria-expanded={view().reviewPanel.opened()}
                    aria-controls="review-panel"
                  >
                    <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                      <Icon
                        size="small"
                        name={view().reviewPanel.opened() ? "layout-right-full" : "layout-right"}
                        class="group-hover/review-toggle:hidden"
                      />
                      <Icon
                        size="small"
                        name="layout-right-partial"
                        class="hidden group-hover/review-toggle:inline-block"
                      />
                      <Icon
                        size="small"
                        name={view().reviewPanel.opened() ? "layout-right" : "layout-right-full"}
                        class="hidden group-active/review-toggle:inline-block"
                      />
                    </div>
                  </Button>
                </TooltipKeybind>
              </div>
              <div class="hidden md:block shrink-0">
                <TooltipKeybind
                  title={language.t("command.fileTree.toggle")}
                  keybind={command.keybind("fileTree.toggle")}
                >
                  <Button
                    variant="ghost"
                    class="group/file-tree-toggle size-6 p-0"
                    onClick={() => layout.fileTree.toggle()}
                    aria-label={language.t("command.fileTree.toggle")}
                    aria-expanded={layout.fileTree.opened()}
                    aria-controls="file-tree-panel"
                  >
                    <div class="relative flex items-center justify-center size-4">
                      <Icon
                        size="small"
                        name="bullet-list"
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
          </Portal>
        )}
      </Show>
    </>
  )
}
