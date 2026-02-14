import { createMemo } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useFile, selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { DialogSelectMcp } from "@/components/dialog-select-mcp"
import { DialogFork } from "@/components/dialog-fork"
import { showToast } from "@opencode-ai/ui/toast"
import { findLast } from "@opencode-ai/util/array"
import { extractPromptFromParts } from "@/utils/prompt"
import { UserMessage } from "@opencode-ai/sdk/v2"
import { combineCommandSections } from "@/pages/session/helpers"
import { canAddSelectionContext } from "@/pages/session/session-command-helpers"

export type SessionCommandContext = {
  command: ReturnType<typeof useCommand>
  dialog: ReturnType<typeof useDialog>
  file: ReturnType<typeof useFile>
  language: ReturnType<typeof useLanguage>
  local: ReturnType<typeof useLocal>
  permission: ReturnType<typeof usePermission>
  prompt: ReturnType<typeof usePrompt>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  terminal: ReturnType<typeof useTerminal>
  layout: ReturnType<typeof useLayout>
  params: ReturnType<typeof useParams>
  navigate: ReturnType<typeof useNavigate>
  tabs: () => ReturnType<ReturnType<typeof useLayout>["tabs"]>
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  info: () => { revert?: { messageID?: string }; share?: { url?: string } } | undefined
  status: () => { type: string }
  userMessages: () => UserMessage[]
  visibleUserMessages: () => UserMessage[]
  activeMessage: () => UserMessage | undefined
  showAllFiles: () => void
  navigateMessageByOffset: (offset: number) => void
  setExpanded: (id: string, fn: (open: boolean | undefined) => boolean) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  addSelectionToContext: (path: string, selection: FileSelection) => void
  focusInput: () => void
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (input: SessionCommandContext) => {
  const sessionCommand = withCategory(input.language.t("command.category.session"))
  const fileCommand = withCategory(input.language.t("command.category.file"))
  const contextCommand = withCategory(input.language.t("command.category.context"))
  const viewCommand = withCategory(input.language.t("command.category.view"))
  const terminalCommand = withCategory(input.language.t("command.category.terminal"))
  const modelCommand = withCategory(input.language.t("command.category.model"))
  const mcpCommand = withCategory(input.language.t("command.category.mcp"))
  const agentCommand = withCategory(input.language.t("command.category.agent"))
  const permissionsCommand = withCategory(input.language.t("command.category.permissions"))

  const sessionCommands = createMemo(() => [
    sessionCommand({
      id: "session.new",
      title: input.language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: () => input.navigate(`/${input.params.dir}/session`),
    }),
  ])

  const fileCommands = createMemo(() => [
    fileCommand({
      id: "file.open",
      title: input.language.t("command.file.open"),
      description: input.language.t("palette.search.placeholder"),
      keybind: "mod+p",
      slash: "open",
      onSelect: () => input.dialog.show(() => <DialogSelectFile onOpenFile={input.showAllFiles} />),
    }),
    fileCommand({
      id: "tab.close",
      title: input.language.t("command.tab.close"),
      keybind: "mod+w",
      disabled: !input.tabs().active(),
      onSelect: () => {
        const active = input.tabs().active()
        if (!active) return
        input.tabs().close(active)
      },
    }),
  ])

  const contextCommands = createMemo(() => [
    contextCommand({
      id: "context.addSelection",
      title: input.language.t("command.context.addSelection"),
      description: input.language.t("command.context.addSelection.description"),
      keybind: "mod+shift+l",
      disabled: !canAddSelectionContext({
        active: input.tabs().active(),
        pathFromTab: input.file.pathFromTab,
        selectedLines: input.file.selectedLines,
      }),
      onSelect: () => {
        const active = input.tabs().active()
        if (!active) return
        const path = input.file.pathFromTab(active)
        if (!path) return

        const range = input.file.selectedLines(path) as SelectedLineRange | null | undefined
        if (!range) {
          showToast({
            title: input.language.t("toast.context.noLineSelection.title"),
            description: input.language.t("toast.context.noLineSelection.description"),
          })
          return
        }

        input.addSelectionToContext(path, selectionFromLines(range))
      },
    }),
  ])

  const viewCommands = createMemo(() => [
    viewCommand({
      id: "terminal.toggle",
      title: input.language.t("command.terminal.toggle"),
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: () => input.view().terminal.toggle(),
    }),
    viewCommand({
      id: "review.toggle",
      title: input.language.t("command.review.toggle"),
      keybind: "mod+shift+r",
      onSelect: () => input.view().reviewPanel.toggle(),
    }),
    viewCommand({
      id: "fileTree.toggle",
      title: input.language.t("command.fileTree.toggle"),
      keybind: "mod+\\",
      onSelect: () => input.layout.fileTree.toggle(),
    }),
    viewCommand({
      id: "input.focus",
      title: input.language.t("command.input.focus"),
      keybind: "ctrl+l",
      onSelect: () => input.focusInput(),
    }),
    terminalCommand({
      id: "terminal.new",
      title: input.language.t("command.terminal.new"),
      description: input.language.t("command.terminal.new.description"),
      keybind: "ctrl+alt+t",
      onSelect: () => {
        if (input.terminal.all().length > 0) input.terminal.new()
        input.view().terminal.open()
      },
    }),
    viewCommand({
      id: "steps.toggle",
      title: input.language.t("command.steps.toggle"),
      description: input.language.t("command.steps.toggle.description"),
      keybind: "mod+e",
      slash: "steps",
      disabled: !input.params.id,
      onSelect: () => {
        const msg = input.activeMessage()
        if (!msg) return
        input.setExpanded(msg.id, (open: boolean | undefined) => !open)
      },
    }),
  ])

  const messageCommands = createMemo(() => [
    sessionCommand({
      id: "message.previous",
      title: input.language.t("command.message.previous"),
      description: input.language.t("command.message.previous.description"),
      keybind: "mod+arrowup",
      disabled: !input.params.id,
      onSelect: () => input.navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: input.language.t("command.message.next"),
      description: input.language.t("command.message.next.description"),
      keybind: "mod+arrowdown",
      disabled: !input.params.id,
      onSelect: () => input.navigateMessageByOffset(1),
    }),
  ])

  const agentCommands = createMemo(() => [
    modelCommand({
      id: "model.choose",
      title: input.language.t("command.model.choose"),
      description: input.language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: "model",
      onSelect: () => input.dialog.show(() => <DialogSelectModel />),
    }),
    mcpCommand({
      id: "mcp.toggle",
      title: input.language.t("command.mcp.toggle"),
      description: input.language.t("command.mcp.toggle.description"),
      keybind: "mod+;",
      slash: "mcp",
      onSelect: () => input.dialog.show(() => <DialogSelectMcp />),
    }),
    agentCommand({
      id: "agent.cycle",
      title: input.language.t("command.agent.cycle"),
      description: input.language.t("command.agent.cycle.description"),
      keybind: "mod+.",
      slash: "agent",
      onSelect: () => input.local.agent.move(1),
    }),
    agentCommand({
      id: "agent.cycle.reverse",
      title: input.language.t("command.agent.cycle.reverse"),
      description: input.language.t("command.agent.cycle.reverse.description"),
      keybind: "shift+mod+.",
      onSelect: () => input.local.agent.move(-1),
    }),
    modelCommand({
      id: "model.variant.cycle",
      title: input.language.t("command.model.variant.cycle"),
      description: input.language.t("command.model.variant.cycle.description"),
      keybind: "shift+mod+d",
      onSelect: () => {
        input.local.model.variant.cycle()
      },
    }),
  ])

  const permissionCommands = createMemo(() => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title:
        input.params.id && input.permission.isAutoAccepting(input.params.id, input.sdk.directory)
          ? input.language.t("command.permissions.autoaccept.disable")
          : input.language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      disabled: !input.params.id || !input.permission.permissionsEnabled(),
      onSelect: () => {
        const sessionID = input.params.id
        if (!sessionID) return
        input.permission.toggleAutoAccept(sessionID, input.sdk.directory)
        showToast({
          title: input.permission.isAutoAccepting(sessionID, input.sdk.directory)
            ? input.language.t("toast.permissions.autoaccept.on.title")
            : input.language.t("toast.permissions.autoaccept.off.title"),
          description: input.permission.isAutoAccepting(sessionID, input.sdk.directory)
            ? input.language.t("toast.permissions.autoaccept.on.description")
            : input.language.t("toast.permissions.autoaccept.off.description"),
        })
      },
    }),
  ])

  const sessionActionCommands = createMemo(() => [
    sessionCommand({
      id: "session.undo",
      title: input.language.t("command.session.undo"),
      description: input.language.t("command.session.undo.description"),
      slash: "undo",
      disabled: !input.params.id || input.visibleUserMessages().length === 0,
      onSelect: async () => {
        const sessionID = input.params.id
        if (!sessionID) return
        if (input.status()?.type !== "idle") {
          await input.sdk.client.session.abort({ sessionID }).catch(() => {})
        }
        const revert = input.info()?.revert?.messageID
        const message = findLast(input.userMessages(), (x) => !revert || x.id < revert)
        if (!message) return
        await input.sdk.client.session.revert({ sessionID, messageID: message.id })
        const parts = input.sync.data.part[message.id]
        if (parts) {
          const restored = extractPromptFromParts(parts, { directory: input.sdk.directory })
          input.prompt.set(restored)
        }
        const priorMessage = findLast(input.userMessages(), (x) => x.id < message.id)
        input.setActiveMessage(priorMessage)
      },
    }),
    sessionCommand({
      id: "session.redo",
      title: input.language.t("command.session.redo"),
      description: input.language.t("command.session.redo.description"),
      slash: "redo",
      disabled: !input.params.id || !input.info()?.revert?.messageID,
      onSelect: async () => {
        const sessionID = input.params.id
        if (!sessionID) return
        const revertMessageID = input.info()?.revert?.messageID
        if (!revertMessageID) return
        const nextMessage = input.userMessages().find((x) => x.id > revertMessageID)
        if (!nextMessage) {
          await input.sdk.client.session.unrevert({ sessionID })
          input.prompt.reset()
          const lastMsg = findLast(input.userMessages(), (x) => x.id >= revertMessageID)
          input.setActiveMessage(lastMsg)
          return
        }
        await input.sdk.client.session.revert({ sessionID, messageID: nextMessage.id })
        const priorMsg = findLast(input.userMessages(), (x) => x.id < nextMessage.id)
        input.setActiveMessage(priorMsg)
      },
    }),
    sessionCommand({
      id: "session.compact",
      title: input.language.t("command.session.compact"),
      description: input.language.t("command.session.compact.description"),
      slash: "compact",
      disabled: !input.params.id || input.visibleUserMessages().length === 0,
      onSelect: async () => {
        const sessionID = input.params.id
        if (!sessionID) return
        const model = input.local.model.current()
        if (!model) {
          showToast({
            title: input.language.t("toast.model.none.title"),
            description: input.language.t("toast.model.none.description"),
          })
          return
        }
        await input.sdk.client.session.summarize({
          sessionID,
          modelID: model.id,
          providerID: model.provider.id,
        })
      },
    }),
    sessionCommand({
      id: "session.fork",
      title: input.language.t("command.session.fork"),
      description: input.language.t("command.session.fork.description"),
      slash: "fork",
      disabled: !input.params.id || input.visibleUserMessages().length === 0,
      onSelect: () => input.dialog.show(() => <DialogFork />),
    }),
  ])

  const shareCommands = createMemo(() => {
    if (input.sync.data.config.share === "disabled") return []
    return [
      sessionCommand({
        id: "session.share",
        title: input.info()?.share?.url
          ? input.language.t("session.share.copy.copyLink")
          : input.language.t("command.session.share"),
        description: input.info()?.share?.url
          ? input.language.t("toast.session.share.success.description")
          : input.language.t("command.session.share.description"),
        slash: "share",
        disabled: !input.params.id,
        onSelect: async () => {
          if (!input.params.id) return

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
                title: input.language.t("toast.session.share.copyFailed.title"),
                variant: "error",
              })
              return
            }

            showToast({
              title: existing
                ? input.language.t("session.share.copy.copied")
                : input.language.t("toast.session.share.success.title"),
              description: input.language.t("toast.session.share.success.description"),
              variant: "success",
            })
          }

          const existing = input.info()?.share?.url
          if (existing) {
            await copy(existing, true)
            return
          }

          const url = await input.sdk.client.session
            .share({ sessionID: input.params.id })
            .then((res) => res.data?.share?.url)
            .catch(() => undefined)
          if (!url) {
            showToast({
              title: input.language.t("toast.session.share.failed.title"),
              description: input.language.t("toast.session.share.failed.description"),
              variant: "error",
            })
            return
          }

          await copy(url, false)
        },
      }),
      sessionCommand({
        id: "session.unshare",
        title: input.language.t("command.session.unshare"),
        description: input.language.t("command.session.unshare.description"),
        slash: "unshare",
        disabled: !input.params.id || !input.info()?.share?.url,
        onSelect: async () => {
          if (!input.params.id) return
          await input.sdk.client.session
            .unshare({ sessionID: input.params.id })
            .then(() =>
              showToast({
                title: input.language.t("toast.session.unshare.success.title"),
                description: input.language.t("toast.session.unshare.success.description"),
                variant: "success",
              }),
            )
            .catch(() =>
              showToast({
                title: input.language.t("toast.session.unshare.failed.title"),
                description: input.language.t("toast.session.unshare.failed.description"),
                variant: "error",
              }),
            )
        },
      }),
    ]
  })

  input.command.register("session", () =>
    combineCommandSections([
      sessionCommands(),
      fileCommands(),
      contextCommands(),
      viewCommands(),
      messageCommands(),
      agentCommands(),
      permissionCommands(),
      sessionActionCommands(),
      shareCommands(),
    ]),
  )
}
