import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Keybind } from "@opencode-ai/ui/keybind"
import { Popover } from "@opencode-ai/ui/popover"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { useParams } from "@solidjs/router"
import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSync } from "@/context/sync"
import { StatusPopover } from "../status-popover"

function useSessionShare(args: {
  globalSDK: ReturnType<typeof useGlobalSDK>
  currentSession: () =>
    | {
        share?: {
          url?: string
        }
      }
    | undefined
  sessionID: () => string | undefined
  projectID: () => string
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
    const sessionID = args.sessionID()
    if (!sessionID || state.share) return
    setState("share", true)
    args.globalSDK.client.session
      .share({ sessionID, project: args.projectID() })
      .catch((error) => {
        console.error("Failed to share session", error)
      })
      .finally(() => {
        setState("share", false)
      })
  }

  const unshareSession = () => {
    const sessionID = args.sessionID()
    if (!sessionID || state.unshare) return
    setState("unshare", true)
    args.globalSDK.client.session
      .unshare({ sessionID, project: args.projectID() })
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
  const sync = useSync()
  const platform = usePlatform()
  const language = useLanguage()

  const projectID = createMemo(() => params.dir ?? "")
  const projectName = createMemo(() => sync.project?.name ?? projectID())
  const hotkey = createMemo(() => command.keybind("file.open"))

  const currentSession = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const showShare = createMemo(() => shareEnabled() && !!params.id)
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey))

  const share = useSessionShare({
    globalSDK,
    currentSession,
    sessionID: () => params.id,
    projectID,
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
                    project: projectName(),
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
              <div class="flex items-center gap-1">
                <div class="hidden md:flex items-center gap-1 shrink-0">
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
                </div>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
