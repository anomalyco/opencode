import { createMemo, createResource, Show } from "solid-js"
import { A, useNavigate, useParams } from "@solidjs/router"
import { useLayout } from "@/context/layout"
import { useCommand } from "@/context/command"
import { useServer } from "@/context/server"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSync } from "@/context/sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { getFilename } from "@opencode-ai/util/path"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
import { iife } from "@opencode-ai/util/iife"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Select } from "@opencode-ai/ui/select"
import { Popover } from "@opencode-ai/ui/popover"
import { TextField } from "@opencode-ai/ui/text-field"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { SessionLspIndicator } from "@/components/session-lsp-indicator"
import { SessionMcpIndicator } from "@/components/session-mcp-indicator"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { same } from "@/utils/same"

export function SessionHeader() {
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const params = useParams()
  const navigate = useNavigate()
  const command = useCommand()
  const server = useServer()
  const dialog = useDialog()
  const sync = useSync()

  const projectDirectory = createMemo(() => base64Decode(params.dir ?? ""))

  const sessions = createMemo(() => (sync.data.session ?? []).filter((s) => !s.parentID))
  const currentSession = createMemo(() => sync.data.session.find((s) => s.id === params.id))
  const parentSession = createMemo(() => {
    const current = currentSession()
    if (!current?.parentID) return undefined
    return sync.data.session.find((s) => s.id === current.parentID)
  })
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const worktrees = createMemo(() => layout.projects.list().map((p) => p.worktree), [], { equals: same })
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const view = createMemo(() => layout.view(sessionKey()))

  function navigateToProject(directory: string) {
    navigate(`/${base64Encode(directory)}`)
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    // Only navigate if we're actually changing to a different session
    if (session.id === params.id) return
    navigate(`/${params.dir}/session/${session.id}`)
  }

  return (
    <header class="h-12 shrink-0 bg-background-base border-b border-border-weak-base flex">
      <button
        type="button"
        class="xl:hidden w-12 shrink-0 flex items-center justify-center border-r border-border-weak-base hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active transition-colors"
        onClick={layout.mobileSidebar.toggle}
      >
        <Icon name="menu" size="small" />
      </button>
      <div class="px-4 flex items-center justify-between gap-4 w-full">
        <div class="flex items-center gap-3 min-w-0">
          <div class="flex items-center gap-2 min-w-0">
            <div class="hidden xl:flex items-center gap-2">
              <Select
                options={worktrees()}
                current={sync.project?.worktree ?? projectDirectory()}
                label={(x) => getFilename(x)}
                onSelect={(x) => (x ? navigateToProject(x) : undefined)}
                class="text-14-regular text-text-base"
                variant="ghost"
              >
                {/* @ts-ignore */}
                {(i) => (
                  <div class="flex items-center gap-2">
                    <Icon name="folder" size="small" />
                    <div class="text-text-strong">{getFilename(i)}</div>
                  </div>
                )}
              </Select>
              <div class="text-text-weaker">/</div>
            </div>
            <Show
              when={parentSession()}
              fallback={
                <>
                  <Select
                    options={sessions()}
                    current={currentSession()}
                    placeholder="New session"
                    label={(x) => x.title}
                    value={(x) => x.id}
                    onSelect={navigateToSession}
                    class="text-14-regular text-text-base max-w-[calc(100vw-180px)] md:max-w-md"
                    variant="ghost"
                  />
                </>
              }
            >
              <div class="flex items-center gap-2 min-w-0">
                <Select
                  options={sessions()}
                  current={parentSession()}
                  placeholder="Back to parent session"
                  label={(x) => x.title}
                  value={(x) => x.id}
                  onSelect={(session) => {
                    // Only navigate if selecting a different session than current parent
                    const currentParent = parentSession()
                    if (session && currentParent && session.id !== currentParent.id) {
                      navigateToSession(session)
                    }
                  }}
                  class="text-14-regular text-text-base max-w-[calc(100vw-180px)] md:max-w-md"
                  variant="ghost"
                />
                <div class="text-text-weaker">/</div>
                <div class="flex items-center gap-1.5 min-w-0">
                  <Tooltip value="Back to parent session">
                    <button
                      type="button"
                      class="flex items-center justify-center gap-1 p-1 rounded hover:bg-surface-raised-base-hover active:bg-surface-raised-base-active transition-colors flex-shrink-0"
                      onClick={() => navigateToSession(parentSession())}
                    >
                      <Icon name="arrow-left" size="small" class="text-icon-base" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </Show>
          </div>
          <Show when={currentSession() && !parentSession()}>
            <TooltipKeybind class="hidden xl:block" title="New session" keybind={command.keybind("session.new")}>
              <IconButton as={A} href={`/${params.dir}/session`} icon="edit-small-2" variant="ghost" />
            </TooltipKeybind>
          </Show>
        </div>
        <div class="flex items-center gap-3">
          <div class="hidden md:flex items-center gap-1">
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                dialog.show(() => <DialogSelectServer />)
              }}
            >
              <div
                classList={{
                  "size-1.5 rounded-full": true,
                  "bg-icon-success-base": server.healthy() === true,
                  "bg-icon-critical-base": server.healthy() === false,
                  "bg-border-weak-base": server.healthy() === undefined,
                }}
              />
              <Icon name="server" size="small" class="text-icon-weak" />
              <span class="text-12-regular text-text-weak truncate max-w-[200px]">{server.name}</span>
            </Button>
            <SessionLspIndicator />
            <SessionMcpIndicator />
          </div>
          <div class="flex items-center gap-1">
            <Show when={currentSession()?.summary?.files}>
              <TooltipKeybind
                class="hidden md:block shrink-0"
                title="Toggle review"
                keybind={command.keybind("review.toggle")}
              >
                <Button
                  variant="ghost"
                  class="group/review-toggle size-6 p-0"
                  onClick={() => view().reviewPanel.toggle()}
                >
                  <div class="relative flex items-center justify-center size-4 [&>*]:absolute [&>*]:inset-0">
                    <Icon
                      name={view().reviewPanel.opened() ? "layout-right" : "layout-left"}
                      size="small"
                      class="group-hover/review-toggle:hidden"
                    />
                    <Icon
                      name={view().reviewPanel.opened() ? "layout-right-partial" : "layout-left-partial"}
                      size="small"
                      class="hidden group-hover/review-toggle:inline-block"
                    />
                    <Icon
                      name={view().reviewPanel.opened() ? "layout-right-full" : "layout-left-full"}
                      size="small"
                      class="hidden group-active/review-toggle:inline-block"
                    />
                  </div>
                </Button>
              </TooltipKeybind>
            </Show>
            <TooltipKeybind
              class="hidden md:block shrink-0"
              title="Toggle terminal"
              keybind={command.keybind("terminal.toggle")}
            >
              <Button variant="ghost" class="group/terminal-toggle size-6 p-0" onClick={() => view().terminal.toggle()}>
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
          <Show when={shareEnabled() && currentSession()}>
            <Popover
              title="Share session"
              trigger={
                <Tooltip class="shrink-0" value="Share session">
                  <IconButton icon="share" variant="ghost" class="" />
                </Tooltip>
              }
            >
              {iife(() => {
                const [url] = createResource(
                  () => currentSession(),
                  async (session) => {
                    if (!session) return
                    let shareURL = session.share?.url
                    if (!shareURL) {
                      shareURL = await globalSDK.client.session
                        .share({ sessionID: session.id, directory: projectDirectory() })
                        .then((r) => r.data?.share?.url)
                        .catch((e) => {
                          console.error("Failed to share session", e)
                          return undefined
                        })
                    }
                    return shareURL
                  },
                  { initialValue: "" },
                )
                return (
                  <Show when={url.latest}>
                    {(shareUrl) => <TextField value={shareUrl()} readOnly copyable class="w-72" />}
                  </Show>
                )
              })}
            </Popover>
          </Show>
        </div>
      </div>
    </header>
  )
}
