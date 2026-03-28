import { useNavigate } from "@solidjs/router"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { showToast } from "@opencode-ai/ui/toast"
import { findLast } from "@opencode-ai/util/array"
import { createSessionTabs } from "@/pages/session/helpers"
import { extractPromptFromParts } from "@/utils/prompt"
import { UserMessage } from "@opencode-ai/sdk/v2"
import { useSessionLayout } from "@/pages/session/session-layout"

export type SessionCommandContext = {
  navigateMessageByOffset: (offset: number) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  focusInput: () => void
  review?: () => boolean
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (actions: SessionCommandContext) => {
  const command = useCommand()
  const dialog = useDialog()
  const file = useFile()
  const language = useLanguage()
  const local = useLocal()
  const permission = usePermission()
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const terminal = useTerminal()
  const layout = useLayout()
  const navigate = useNavigate()
  const { params, tabs, view } = useSessionLayout()

  const info = () => {
    const id = params.id
    if (!id) return
    return sync.session.get(id)
  }
  const hasReview = () => {
    const id = params.id
    if (!id) return false
    return Math.max(info()?.summary?.files ?? 0, (sync.data.session_diff[id] ?? []).length) > 0
  }
  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: actions.review,
    hasReview,
  })
  const activeFileTab = tabState.activeFileTab
  const closableTab = tabState.closableTab

  const idle = { type: "idle" as const }
  const status = () => sync.data.session_status[params.id ?? ""] ?? idle
  const messages = () => {
    const id = params.id
    if (!id) return []
    return sync.data.message[id] ?? []
  }
  const userMessages = () => messages().filter((m) => m.role === "user") as UserMessage[]
  const visibleUserMessages = () => {
    const revert = info()?.revert?.messageID
    if (!revert) return userMessages()
    return userMessages().filter((m) => m.id < revert)
  }

  const showAllFiles = () => {
    if (layout.fileTree.tab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addSelectionToContext = (path: string, selection: FileSelection) => {
    const preview = selectionPreview(path, selection)
    prompt.context.add({ type: "file", path, selection, preview })
  }

  const canAddSelectionContext = () => {
    const tab = activeFileTab()
    if (!tab) return false
    const path = file.pathFromTab(tab)
    if (!path) return false
    return file.selectedLines(path) != null
  }

  const navigateMessageByOffset = actions.navigateMessageByOffset
  const setActiveMessage = actions.setActiveMessage
  const focusInput = actions.focusInput

  const sessionCommand = withCategory(language.t("command.category.session"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const terminalCommand = withCategory(language.t("command.category.terminal"))
  const modelCommand = withCategory(language.t("command.category.model"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const agentCommand = withCategory(language.t("command.category.agent"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))

  const isAutoAcceptActive = () => {
    const sessionID = params.id
    if (sessionID) return permission.isAutoAccepting(sessionID, sdk.directory)
    return permission.isAutoAcceptingDirectory(sdk.directory)
  }
  command.register("session", () => {
    const share =
      sync.data.config.share === "disabled"
        ? []
        : [
            sessionCommand({
              id: "session.share",
              title: info()?.share?.url
                ? language.t("session.share.copy.copyLink")
                : language.t("command.session.share"),
              description: info()?.share?.url
                ? language.t("toast.session.share.success.description")
                : language.t("command.session.share.description"),
              slash: "share",
              disabled: !params.id,
              onSelect: async () => {
                if (!params.id) return

                const write = (value: string) => {
                  const body = typeof document === "undefined" ? undefined : document.body
                  if (body) {
                    const textarea = document.createElement("textarea")
                    textarea.value = value
                    textarea.setAttribute("readonly", "")
                    textarea.style.position = "fixed"
                    textarea.style.opacity = "0"
                    textarea.style.pointerEvents = "none"
                    body.appendChild(textarea)
                    textarea.select()
                    const copied = document.execCommand("copy")
                    body.removeChild(textarea)
                    if (copied) return Promise.resolve(true)
                  }

                  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
                  if (!clipboard?.writeText) return Promise.resolve(false)
                  return clipboard.writeText(value).then(
                    () => true,
                    () => false,
                  )
                }

                const copy = async (url: string, existing: boolean) => {
                  const ok = await write(url)
                  if (!ok) {
                    showToast({
                      title: language.t("toast.session.share.copyFailed.title"),
                      variant: "error",
                    })
                    return
                  }

                  showToast({
                    title: existing
                      ? language.t("session.share.copy.copied")
                      : language.t("toast.session.share.success.title"),
                    description: language.t("toast.session.share.success.description"),
                    variant: "success",
                  })
                }

                const existing = info()?.share?.url
                if (existing) {
                  await copy(existing, true)
                  return
                }

                const url = await sdk.client.session
                  .share({ sessionID: params.id })
                  .then((res) => res.data?.share?.url)
                  .catch(() => undefined)
                if (!url) {
                  showToast({
                    title: language.t("toast.session.share.failed.title"),
                    description: language.t("toast.session.share.failed.description"),
                    variant: "error",
                  })
                  return
                }

                await copy(url, false)
              },
            }),
            sessionCommand({
              id: "session.unshare",
              title: language.t("command.session.unshare"),
              description: language.t("command.session.unshare.description"),
              slash: "unshare",
              disabled: !params.id || !info()?.share?.url,
              onSelect: async () => {
                if (!params.id) return
                await sdk.client.session
                  .unshare({ sessionID: params.id })
                  .then(() =>
                    showToast({
                      title: language.t("toast.session.unshare.success.title"),
                      description: language.t("toast.session.unshare.success.description"),
                      variant: "success",
                    }),
                  )
                  .catch(() =>
                    showToast({
                      title: language.t("toast.session.unshare.failed.title"),
                      description: language.t("toast.session.unshare.failed.description"),
                      variant: "error",
                    }),
                  )
              },
            }),
          ]

    return [
      sessionCommand({
        id: "session.new",
        title: language.t("command.session.new"),
        keybind: "mod+shift+s",
        slash: "new",
        onSelect: () => navigate(`/${params.dir}/session`),
      }),
      fileCommand({
        id: "file.open",
        title: language.t("command.file.open"),
        description: language.t("palette.search.placeholder"),
        keybind: "mod+k,mod+p",
        slash: "open",
        onSelect: () => {
          void import("@/components/dialog-select-file").then((x) => {
            dialog.show(() => <x.DialogSelectFile onOpenFile={showAllFiles} />)
          })
        },
      }),
      fileCommand({
        id: "tab.close",
        title: language.t("command.tab.close"),
        keybind: "mod+w",
        disabled: !closableTab(),
        onSelect: () => {
          const tab = closableTab()
          if (!tab) return
          tabs().close(tab)
        },
      }),
      contextCommand({
        id: "context.addSelection",
        title: language.t("command.context.addSelection"),
        description: language.t("command.context.addSelection.description"),
        keybind: "mod+shift+l",
        disabled: !canAddSelectionContext(),
        onSelect: () => {
          const tab = activeFileTab()
          if (!tab) return
          const path = file.pathFromTab(tab)
          if (!path) return

          const range = file.selectedLines(path) as SelectedLineRange | null | undefined
          if (!range) {
            showToast({
              title: language.t("toast.context.noLineSelection.title"),
              description: language.t("toast.context.noLineSelection.description"),
            })
            return
          }

          addSelectionToContext(path, selectionFromLines(range))
        },
      }),
      viewCommand({
        id: "terminal.toggle",
        title: language.t("command.terminal.toggle"),
        keybind: "ctrl+`",
        slash: "terminal",
        onSelect: () => view().terminal.toggle(),
      }),
      viewCommand({
        id: "review.toggle",
        title: language.t("command.review.toggle"),
        keybind: "mod+shift+r",
        onSelect: () => view().reviewPanel.toggle(),
      }),
      viewCommand({
        id: "fileTree.toggle",
        title: language.t("command.fileTree.toggle"),
        keybind: "mod+\\",
        onSelect: () => layout.fileTree.toggle(),
      }),
      viewCommand({
        id: "input.focus",
        title: language.t("command.input.focus"),
        keybind: "ctrl+l",
        onSelect: focusInput,
      }),
      terminalCommand({
        id: "terminal.new",
        title: language.t("command.terminal.new"),
        description: language.t("command.terminal.new.description"),
        keybind: "ctrl+alt+t",
        onSelect: () => {
          if (terminal.all().length > 0) terminal.new()
          view().terminal.open()
        },
      }),
      sessionCommand({
        id: "message.previous",
        title: language.t("command.message.previous"),
        description: language.t("command.message.previous.description"),
        keybind: "mod+alt+[",
        disabled: !params.id,
        onSelect: () => navigateMessageByOffset(-1),
      }),
      sessionCommand({
        id: "message.next",
        title: language.t("command.message.next"),
        description: language.t("command.message.next.description"),
        keybind: "mod+alt+]",
        disabled: !params.id,
        onSelect: () => navigateMessageByOffset(1),
      }),
      modelCommand({
        id: "model.choose",
        title: language.t("command.model.choose"),
        description: language.t("command.model.choose.description"),
        keybind: "mod+'",
        slash: "model",
        onSelect: () => {
          void import("@/components/dialog-select-model").then((x) => {
            dialog.show(() => <x.DialogSelectModel model={local.model} />)
          })
        },
      }),
      mcpCommand({
        id: "mcp.toggle",
        title: language.t("command.mcp.toggle"),
        description: language.t("command.mcp.toggle.description"),
        keybind: "mod+;",
        slash: "mcp",
        onSelect: () => {
          void import("@/components/dialog-select-mcp").then((x) => {
            dialog.show(() => <x.DialogSelectMcp />)
          })
        },
      }),
      agentCommand({
        id: "agent.cycle",
        title: language.t("command.agent.cycle"),
        description: language.t("command.agent.cycle.description"),
        keybind: "mod+.",
        slash: "agent",
        onSelect: () => local.agent.move(1),
      }),
      agentCommand({
        id: "agent.cycle.reverse",
        title: language.t("command.agent.cycle.reverse"),
        description: language.t("command.agent.cycle.reverse.description"),
        keybind: "shift+mod+.",
        onSelect: () => local.agent.move(-1),
      }),
      modelCommand({
        id: "model.variant.cycle",
        title: language.t("command.model.variant.cycle"),
        description: language.t("command.model.variant.cycle.description"),
        keybind: "shift+mod+d",
        onSelect: () => local.model.variant.cycle(),
      }),
      permissionsCommand({
        id: "permissions.autoaccept",
        title: isAutoAcceptActive()
          ? language.t("command.permissions.autoaccept.disable")
          : language.t("command.permissions.autoaccept.enable"),
        keybind: "mod+shift+a",
        disabled: false,
        onSelect: () => {
          const sessionID = params.id
          if (sessionID) permission.toggleAutoAccept(sessionID, sdk.directory)
          else permission.toggleAutoAcceptDirectory(sdk.directory)

          const active = sessionID
            ? permission.isAutoAccepting(sessionID, sdk.directory)
            : permission.isAutoAcceptingDirectory(sdk.directory)
          showToast({
            title: active
              ? language.t("toast.permissions.autoaccept.on.title")
              : language.t("toast.permissions.autoaccept.off.title"),
            description: active
              ? language.t("toast.permissions.autoaccept.on.description")
              : language.t("toast.permissions.autoaccept.off.description"),
          })
        },
      }),
      sessionCommand({
        id: "session.undo",
        title: language.t("command.session.undo"),
        description: language.t("command.session.undo.description"),
        slash: "undo",
        disabled: !params.id || visibleUserMessages().length === 0,
        onSelect: async () => {
          const sessionID = params.id
          if (!sessionID) return
          if (status().type !== "idle") {
            await sdk.client.session.abort({ sessionID }).catch(() => {})
          }
          const revert = info()?.revert?.messageID
          const message = findLast(userMessages(), (x) => !revert || x.id < revert)
          if (!message) return
          await sdk.client.session.revert({ sessionID, messageID: message.id })
          const parts = sync.data.part[message.id]
          if (parts) {
            const restored = extractPromptFromParts(parts, { directory: sdk.directory })
            prompt.set(restored)
          }
          const priorMessage = findLast(userMessages(), (x) => x.id < message.id)
          setActiveMessage(priorMessage)
        },
      }),
      sessionCommand({
        id: "session.redo",
        title: language.t("command.session.redo"),
        description: language.t("command.session.redo.description"),
        slash: "redo",
        disabled: !params.id || !info()?.revert?.messageID,
        onSelect: async () => {
          const sessionID = params.id
          if (!sessionID) return
          const revertMessageID = info()?.revert?.messageID
          if (!revertMessageID) return
          const nextMessage = userMessages().find((x) => x.id > revertMessageID)
          if (!nextMessage) {
            await sdk.client.session.unrevert({ sessionID })
            prompt.reset()
            const lastMsg = findLast(userMessages(), (x) => x.id >= revertMessageID)
            setActiveMessage(lastMsg)
            return
          }
          await sdk.client.session.revert({ sessionID, messageID: nextMessage.id })
          const priorMsg = findLast(userMessages(), (x) => x.id < nextMessage.id)
          setActiveMessage(priorMsg)
        },
      }),
      sessionCommand({
        id: "session.compact",
        title: language.t("command.session.compact"),
        description: language.t("command.session.compact.description"),
        slash: "compact",
        disabled: !params.id || visibleUserMessages().length === 0,
        onSelect: async () => {
          const sessionID = params.id
          if (!sessionID) return
          const model = local.model.current()
          if (!model) {
            showToast({
              title: language.t("toast.model.none.title"),
              description: language.t("toast.model.none.description"),
            })
            return
          }
          await sdk.client.session.summarize({
            sessionID,
            modelID: model.id,
            providerID: model.provider.id,
          })
        },
      }),
      sessionCommand({
        id: "session.fork",
        title: language.t("command.session.fork"),
        description: language.t("command.session.fork.description"),
        slash: "fork",
        disabled: !params.id || visibleUserMessages().length === 0,
        onSelect: () => {
          void import("@/components/dialog-fork").then((x) => {
            dialog.show(() => <x.DialogFork />)
          })
        },
      }),
      ...share,
    ]
  })
}
