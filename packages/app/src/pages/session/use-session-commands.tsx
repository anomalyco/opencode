import { createMemo } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useCommand } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useFile, selectionFromLines, type FileSelection } from "@/context/file"
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

export const useSessionCommands = (input: {
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
}) => {
  const sessionCommands = createMemo(() => [
    {
      id: "session.new",
      title: input.language.t("command.session.new"),
      category: input.language.t("command.category.session"),
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: () => input.navigate(`/${input.params.dir}/session`),
    },
  ])

  const fileCommands = createMemo(() => [
    {
      id: "file.open",
      title: input.language.t("command.file.open"),
      description: input.language.t("palette.search.placeholder"),
      category: input.language.t("command.category.file"),
      keybind: "mod+p",
      slash: "open",
      onSelect: () => input.dialog.show(() => <DialogSelectFile onOpenFile={input.showAllFiles} />),
    },
    {
      id: "tab.close",
      title: input.language.t("command.tab.close"),
      category: input.language.t("command.category.file"),
      keybind: "mod+w",
      disabled: !input.tabs().active(),
      onSelect: () => {
        const active = input.tabs().active()
        if (!active) return
        input.tabs().close(active)
      },
    },
  ])

  const contextCommands = createMemo(() => [
    {
      id: "context.addSelection",
      title: input.language.t("command.context.addSelection"),
      description: input.language.t("command.context.addSelection.description"),
      category: input.language.t("command.category.context"),
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

        const range = input.file.selectedLines(path)
        if (!range) {
          showToast({
            title: input.language.t("toast.context.noLineSelection.title"),
            description: input.language.t("toast.context.noLineSelection.description"),
          })
          return
        }

        input.addSelectionToContext(path, selectionFromLines(range))
      },
    },
  ])

  const viewCommands = createMemo(() => [
    {
      id: "terminal.toggle",
      title: input.language.t("command.terminal.toggle"),
      description: "",
      category: input.language.t("command.category.view"),
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: () => input.view().terminal.toggle(),
    },
    {
      id: "review.toggle",
      title: input.language.t("command.review.toggle"),
      description: "",
      category: input.language.t("command.category.view"),
      keybind: "mod+shift+r",
      onSelect: () => input.view().reviewPanel.toggle(),
    },
    {
      id: "fileTree.toggle",
      title: input.language.t("command.fileTree.toggle"),
      description: "",
      category: input.language.t("command.category.view"),
      keybind: "mod+\\",
      onSelect: () => input.layout.fileTree.toggle(),
    },
    {
      id: "terminal.new",
      title: input.language.t("command.terminal.new"),
      description: input.language.t("command.terminal.new.description"),
      category: input.language.t("command.category.terminal"),
      keybind: "ctrl+alt+t",
      onSelect: () => {
        if (input.terminal.all().length > 0) input.terminal.new()
        input.view().terminal.open()
      },
    },
    {
      id: "steps.toggle",
      title: input.language.t("command.steps.toggle"),
      description: input.language.t("command.steps.toggle.description"),
      category: input.language.t("command.category.view"),
      keybind: "mod+e",
      slash: "steps",
      disabled: !input.params.id,
      onSelect: () => {
        const msg = input.activeMessage()
        if (!msg) return
        input.setExpanded(msg.id, (open: boolean | undefined) => !open)
      },
    },
  ])

  const messageCommands = createMemo(() => [
    {
      id: "message.previous",
      title: input.language.t("command.message.previous"),
      description: input.language.t("command.message.previous.description"),
      category: input.language.t("command.category.session"),
      keybind: "mod+arrowup",
      disabled: !input.params.id,
      onSelect: () => input.navigateMessageByOffset(-1),
    },
    {
      id: "message.next",
      title: input.language.t("command.message.next"),
      description: input.language.t("command.message.next.description"),
      category: input.language.t("command.category.session"),
      keybind: "mod+arrowdown",
      disabled: !input.params.id,
      onSelect: () => input.navigateMessageByOffset(1),
    },
  ])

  const agentCommands = createMemo(() => [
    {
      id: "model.choose",
      title: input.language.t("command.model.choose"),
      description: input.language.t("command.model.choose.description"),
      category: input.language.t("command.category.model"),
      keybind: "mod+'",
      slash: "model",
      onSelect: () => input.dialog.show(() => <DialogSelectModel />),
    },
    {
      id: "mcp.toggle",
      title: input.language.t("command.mcp.toggle"),
      description: input.language.t("command.mcp.toggle.description"),
      category: input.language.t("command.category.mcp"),
      keybind: "mod+;",
      slash: "mcp",
      onSelect: () => input.dialog.show(() => <DialogSelectMcp />),
    },
    {
      id: "agent.cycle",
      title: input.language.t("command.agent.cycle"),
      description: input.language.t("command.agent.cycle.description"),
      category: input.language.t("command.category.agent"),
      keybind: "mod+.",
      slash: "agent",
      onSelect: () => input.local.agent.move(1),
    },
    {
      id: "agent.cycle.reverse",
      title: input.language.t("command.agent.cycle.reverse"),
      description: input.language.t("command.agent.cycle.reverse.description"),
      category: input.language.t("command.category.agent"),
      keybind: "shift+mod+.",
      onSelect: () => input.local.agent.move(-1),
    },
    {
      id: "model.variant.cycle",
      title: input.language.t("command.model.variant.cycle"),
      description: input.language.t("command.model.variant.cycle.description"),
      category: input.language.t("command.category.model"),
      keybind: "shift+mod+d",
      onSelect: () => {
        input.local.model.variant.cycle()
      },
    },
  ])

  const permissionCommands = createMemo(() => [
    {
      id: "permissions.autoaccept",
      title:
        input.params.id && input.permission.isAutoAccepting(input.params.id, input.sdk.directory)
          ? input.language.t("command.permissions.autoaccept.disable")
          : input.language.t("command.permissions.autoaccept.enable"),
      category: input.language.t("command.category.permissions"),
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
    },
  ])

  const sessionActionCommands = createMemo(() => [
    {
      id: "session.undo",
      title: input.language.t("command.session.undo"),
      description: input.language.t("command.session.undo.description"),
      category: input.language.t("command.category.session"),
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
    },
    {
      id: "session.redo",
      title: input.language.t("command.session.redo"),
      description: input.language.t("command.session.redo.description"),
      category: input.language.t("command.category.session"),
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
    },
    {
      id: "session.compact",
      title: input.language.t("command.session.compact"),
      description: input.language.t("command.session.compact.description"),
      category: input.language.t("command.category.session"),
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
    },
    {
      id: "session.fork",
      title: input.language.t("command.session.fork"),
      description: input.language.t("command.session.fork.description"),
      category: input.language.t("command.category.session"),
      slash: "fork",
      disabled: !input.params.id || input.visibleUserMessages().length === 0,
      onSelect: () => input.dialog.show(() => <DialogFork />),
    },
  ])

  const shareCommands = createMemo(() => {
    if (input.sync.data.config.share === "disabled") return []
    return [
      {
        id: "session.share",
        title: input.language.t("command.session.share"),
        description: input.language.t("command.session.share.description"),
        category: input.language.t("command.category.session"),
        slash: "share",
        disabled: !input.params.id || !!input.info()?.share?.url,
        onSelect: async () => {
          if (!input.params.id) return
          await input.sdk.client.session
            .share({ sessionID: input.params.id })
            .then((res) => {
              navigator.clipboard.writeText(res.data!.share!.url).catch(() =>
                showToast({
                  title: input.language.t("toast.session.share.copyFailed.title"),
                  variant: "error",
                }),
              )
            })
            .then(() =>
              showToast({
                title: input.language.t("toast.session.share.success.title"),
                description: input.language.t("toast.session.share.success.description"),
                variant: "success",
              }),
            )
            .catch(() =>
              showToast({
                title: input.language.t("toast.session.share.failed.title"),
                description: input.language.t("toast.session.share.failed.description"),
                variant: "error",
              }),
            )
        },
      },
      {
        id: "session.unshare",
        title: input.language.t("command.session.unshare"),
        description: input.language.t("command.session.unshare.description"),
        category: input.language.t("command.category.session"),
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
      },
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
