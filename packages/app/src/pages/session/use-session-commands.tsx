import { useNavigate } from "@solidjs/router"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { DialogSelectModel } from "@/components/dialog-select-model"
import { DialogSelectMcp } from "@/components/dialog-select-mcp"
import { DialogSelectSkill } from "@/components/dialog-select-skill"
import { DialogFork } from "@/components/dialog-fork"
import { showToast } from "@opencode-ai/ui/toast"
import { findLast } from "@opencode-ai/core/util/array"
import { createSessionTabs } from "@/pages/session/helpers"
import { extractPromptFromParts } from "@/utils/prompt"
import { UserMessage } from "@opencode-ai/sdk/v2"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import { dict as enDict } from "@/i18n/en"

export type SessionCommandContext = {
  command: ReturnType<typeof useCommand>
  dialog: ReturnType<typeof useDialog>
  file: ReturnType<typeof useFile>
  language: ReturnType<typeof useLanguage>
  local: ReturnType<typeof useLocal>
  permission: ReturnType<typeof usePermission>
  platform: ReturnType<typeof usePlatform>
  prompt: ReturnType<typeof usePrompt>
  server: ReturnType<typeof useServer>
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
  const platform = usePlatform()
  const prompt = usePrompt()
  const sdk = useSDK()
  const settings = useSettings()
  const sync = useSync()
  const terminal = useTerminal()
  const layout = useLayout()
  const navigate = useNavigate()
  const { params, tabs, view } = useSessionLayout()

  type DictKey = keyof typeof enDict
  const kw = (...keys: DictKey[]) => (language.locale() === "en" ? undefined : keys.map((k) => enDict[k]).join(" "))

  const info = () => {
    const id = params.id
    if (!id) return
    return sync.session.get(id)
  }
  const hasReview = () => !!params.id
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
  const shown = () =>
    platform.platform !== "desktop" ||
    import.meta.env.VITE_OPENCODE_CHANNEL !== "beta" ||
    settings.general.showFileTree()

  const projectDirectory = () => decode64(params.dir) ?? ""

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
    terminalCommand({
      id: "terminal.openGhostty",
      title: input.language.t("command.terminal.openGhostty"),
      description: input.language.t("command.terminal.openGhostty.description"),
      disabled: input.platform.platform !== "desktop" || !input.platform.openPath || !input.server.isLocal(),
      onSelect: () => {
        const directory = input.sdk.directory
        if (!directory) return
        Promise.resolve(input.platform.openPath?.(directory, "Ghostty")).catch((err: unknown) => {
          showToast({
            variant: "error",
            title: input.language.t("common.requestFailed"),
            description: err instanceof Error ? err.message : String(err),
          })
        })
      },
    }),
    terminalCommand({
      id: "terminal.openWezTerm",
      title: input.language.t("command.terminal.openWezTerm"),
      description: input.language.t("command.terminal.openWezTerm.description"),
      disabled: input.platform.platform !== "desktop" || !input.platform.openInEditor || !input.server.isLocal(),
      onSelect: () => {
        const directory = input.sdk.directory
        if (!directory) return
        Promise.resolve(input.platform.openInEditor?.("WezTerm", directory)).catch((err: unknown) => {
          showToast({
            variant: "error",
            title: input.language.t("common.requestFailed"),
            description: err instanceof Error ? err.message : String(err),
          })
        })
      },
    }),
  ])

  const messageCommands = createMemo(() => [
    sessionCommand({
      id: "message.previous",
      title: input.language.t("command.message.previous"),
      description: input.language.t("command.message.previous.description"),
      keybind: "mod+shift+arrowup",
      disabled: !input.params.id,
      onSelect: () => input.navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: input.language.t("command.message.next"),
      description: input.language.t("command.message.next.description"),
      keybind: "mod+shift+arrowdown",
      disabled: !input.params.id,
      onSelect: () => input.navigateMessageByOffset(1),
    }),
  ])

  const sessionCommand = withCategory(language.t("command.category.session"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const terminalCommand = withCategory(language.t("command.category.terminal"))
  const modelCommand = withCategory(language.t("command.category.model"))
  const projectCommand = withCategory(language.t("command.category.project"))
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
              keywords: kw("command.session.share", "command.session.share.description"),
              slash: "share",
              disabled: !params.id,
              onSelect: async () => {
                if (!params.id) return

    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) return false
    return clipboard.writeText(value).then(
      () => true,
      () => false,
    )
  }

  const copyShare = async (url: string, existing: boolean) => {
    if (!(await write(url))) {
      showToast({
        title: language.t("toast.session.share.copyFailed.title"),
        variant: "error",
      })
      return
    }

    showToast({
      title: existing ? language.t("session.share.copy.copied") : language.t("toast.session.share.success.title"),
      description: language.t("toast.session.share.success.description"),
      variant: "success",
    })
  }

  const share = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const existing = info()?.share?.url
    if (existing) {
      await copyShare(existing, true)
      return
    }

    const url = await sdk.client.session
      .share({ sessionID })
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
              keywords: kw("command.session.unshare", "command.session.unshare.description"),
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

  const unshare = async () => {
    const sessionID = params.id
    if (!sessionID) return

    await sdk.client.session
      .unshare({ sessionID })
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
  }

  const openFile = () => {
    void import("@/components/dialog-select-file").then((x) => {
      dialog.show(() => <x.DialogSelectFile onOpenFile={showAllFiles} />)
    })
  }

  const closeTab = () => {
    const tab = closableTab()
    if (!tab) return
    tabs().close(tab)
  }

  const addSelection = () => {
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
  }

  const openTerminal = () => {
    if (terminal.all().length > 0) terminal.new()
    view().terminal.open()
  }

  const chooseModel = () => {
    void import("@/components/dialog-select-model").then((x) => {
      dialog.show(() => <x.DialogSelectModel model={local.model} />)
    })
  }

  const chooseMcp = () => {
    void import("@/components/dialog-select-mcp").then((x) => {
      dialog.show(() => <x.DialogSelectMcp />)
    })
  }

  const toggleAutoAccept = () => {
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
  }

  const undo = async () => {
    const sessionID = params.id
    if (!sessionID) return

    if (sync.data.session_working(params.id ?? "")) {
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

    const prev = findLast(userMessages(), (x) => x.id < message.id)
    setActiveMessage(prev)
  }

  const redo = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const revertMessageID = info()?.revert?.messageID
    if (!revertMessageID) return

    const next = userMessages().find((x) => x.id > revertMessageID)
    if (!next) {
      await sdk.client.session.unrevert({ sessionID })
      prompt.reset()
      const last = findLast(userMessages(), (x) => x.id >= revertMessageID)
      setActiveMessage(last)
      return
    }

    await sdk.client.session.revert({ sessionID, messageID: next.id })
    const prev = findLast(userMessages(), (x) => x.id < next.id)
    setActiveMessage(prev)
  }

  const compact = async () => {
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
  }

  const fork = () => {
    void import("@/components/dialog-fork").then((x) => {
      dialog.show(() => <x.DialogFork />)
    })
  }

  const shareCmds = () => {
    if (sync.data.config.share === "disabled") return []
    return [
      sessionCommand({
        id: "session.new",
        title: language.t("command.session.new"),
        keywords: kw("command.session.new"),
        keybind: "mod+shift+s",
        slash: "new",
        onSelect: () => navigate(`/${params.dir}/session`),
      }),
      fileCommand({
        id: "file.open",
        title: language.t("command.file.open"),
        description: language.t("session.header.searchFiles"),
        keywords: kw("command.file.open"),
        keybind: "mod+p",
        slash: "open",
        onSelect: () =>
          dialog.show(() => <DialogSelectFile mode="files" onOpenFile={showAllFiles} />, undefined, {
            modal: false,
            preventScroll: false,
          }),
      }),
      fileCommand({
        id: "command.palette",
        title: language.t("command.palette"),
        description: language.t("palette.search.commands"),
        keywords: kw("command.palette"),
        keybind: "mod+shift+p",
        onSelect: () =>
          dialog.show(() => <DialogSelectFile mode="commands" />, undefined, {
            modal: false,
            preventScroll: false,
          }),
      }),
      projectCommand({
        id: "project.copyPath",
        title: language.t("command.project.copyPath"),
        description: language.t("command.project.copyPath.description"),
        keywords: kw("command.project.copyPath", "command.project.copyPath.description"),
        disabled: !projectDirectory(),
        onSelect: () => {
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
        },
      }),
      fileCommand({
        id: "tab.close",
        title: language.t("command.tab.close"),
        keywords: kw("command.tab.close"),
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
        keywords: kw("command.context.addSelection", "command.context.addSelection.description"),
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
        keywords: kw("command.terminal.toggle"),
        keybind: "ctrl+`",
        slash: "terminal",
        onSelect: () => view().terminal.toggle(),
      }),
      viewCommand({
        id: "review.toggle",
        title: language.t("command.review.toggle"),
        keywords: kw("command.review.toggle"),
        keybind: "mod+shift+r",
        onSelect: () => view().reviewPanel.toggle(),
      }),
      viewCommand({
        id: "fileTree.toggle",
        title: language.t("command.fileTree.toggle"),
        keywords: kw("command.fileTree.toggle"),
        keybind: "mod+\\",
        onSelect: () => layout.fileTree.toggle(),
      }),
      viewCommand({
        id: "input.focus",
        title: language.t("command.input.focus"),
        keywords: kw("command.input.focus"),
        keybind: "ctrl+l",
        onSelect: focusInput,
      }),
      terminalCommand({
        id: "terminal.new",
        title: language.t("command.terminal.new"),
        description: language.t("command.terminal.new.description"),
        keywords: kw("command.terminal.new", "command.terminal.new.description"),
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
        keywords: kw("command.message.previous", "command.message.previous.description"),
        keybind: "mod+arrowup",
        disabled: !params.id,
        onSelect: share,
      }),
      sessionCommand({
        id: "message.next",
        title: language.t("command.message.next"),
        description: language.t("command.message.next.description"),
        keywords: kw("command.message.next", "command.message.next.description"),
        keybind: "mod+arrowdown",
        disabled: !params.id,
        onSelect: () => navigateMessageByOffset(1),
      }),
      modelCommand({
        id: "model.choose",
        title: language.t("command.model.choose"),
        description: language.t("command.model.choose.description"),
        keywords: kw("command.model.choose", "command.model.choose.description"),
        keybind: "mod+'",
        slash: "model",
        onSelect: () => dialog.show(() => <DialogSelectModel />),
      }),
      mcpCommand({
        id: "mcp.toggle",
        title: language.t("command.mcp.toggle"),
        description: language.t("command.mcp.toggle.description"),
        keywords: kw("command.mcp.toggle", "command.mcp.toggle.description"),
        keybind: "mod+;",
        slash: "mcp",
        onSelect: () => dialog.show(() => <DialogSelectMcp />),
      }),
      withCategory(language.t("command.category.skill"))({
        id: "skill.list",
        title: language.t("command.skill.list"),
        description: language.t("command.skill.list.description"),
        keywords: kw("command.skill.list", "command.skill.list.description"),
        keybind: "mod+shift+;",
        onSelect: () => dialog.show(() => <DialogSelectSkill />),
      }),
      agentCommand({
        id: "agent.cycle",
        title: language.t("command.agent.cycle"),
        description: language.t("command.agent.cycle.description"),
        keywords: kw("command.agent.cycle", "command.agent.cycle.description"),
        keybind: "mod+.",
        slash: "agent",
        onSelect: () => local.agent.move(1),
      }),
      agentCommand({
        id: "agent.cycle.reverse",
        title: language.t("command.agent.cycle.reverse"),
        description: language.t("command.agent.cycle.reverse.description"),
        keywords: kw("command.agent.cycle.reverse", "command.agent.cycle.reverse.description"),
        keybind: "shift+mod+.",
        onSelect: () => local.agent.move(-1),
      }),
      modelCommand({
        id: "model.variant.cycle",
        title: language.t("command.model.variant.cycle"),
        description: language.t("command.model.variant.cycle.description"),
        keywords: kw("command.model.variant.cycle", "command.model.variant.cycle.description"),
        keybind: "shift+mod+d",
        onSelect: () => local.model.variant.cycle(),
      }),
      permissionsCommand({
        id: "permissions.autoaccept",
        title: isAutoAcceptActive()
          ? language.t("command.permissions.autoaccept.disable")
          : language.t("command.permissions.autoaccept.enable"),
        keywords: kw("command.permissions.autoaccept.enable", "command.permissions.autoaccept.disable"),
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
        keywords: kw("command.session.undo", "command.session.undo.description"),
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
        keywords: kw("command.session.redo", "command.session.redo.description"),
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
        keywords: kw("command.session.compact", "command.session.compact.description"),
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
        keywords: kw("command.session.fork", "command.session.fork.description"),
        slash: "fork",
        disabled: !params.id || visibleUserMessages().length === 0,
        onSelect: () => dialog.show(() => <DialogFork />),
      }),
      ...share,
    ]
  }

  const sessionCmds = () => [
    sessionCommand({
      id: "session.new",
      title: language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: () => navigate(`/${params.dir}/session`),
    }),
    sessionCommand({
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      slash: "undo",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: undo,
    }),
    sessionCommand({
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      slash: "redo",
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: redo,
    }),
    sessionCommand({
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      slash: "compact",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: compact,
    }),
    sessionCommand({
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      slash: "fork",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: fork,
    }),
  ]

  const fileCmds = () => [
    fileCommand({
      id: "file.open",
      title: language.t("command.file.open"),
      description: language.t("palette.search.placeholder"),
      keybind: "mod+k,mod+p",
      slash: "open",
      onSelect: openFile,
    }),
    fileCommand({
      id: "tab.close",
      title: language.t("command.tab.close"),
      keybind: "mod+w",
      disabled: !closableTab(),
      onSelect: closeTab,
    }),
  ]

  const contextCmds = () => [
    contextCommand({
      id: "context.addSelection",
      title: language.t("command.context.addSelection"),
      description: language.t("command.context.addSelection.description"),
      keybind: "mod+shift+l",
      disabled: !canAddSelectionContext(),
      onSelect: addSelection,
    }),
  ]

  const viewCmds = () => [
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
    ...(shown()
      ? [
          viewCommand({
            id: "fileTree.toggle",
            title: language.t("command.fileTree.toggle"),
            keybind: "mod+\\",
            onSelect: () => layout.fileTree.toggle(),
          }),
        ]
      : []),
    viewCommand({
      id: "input.focus",
      title: language.t("command.input.focus"),
      keybind: "ctrl+l",
      onSelect: focusInput,
    }),
  ]

  const terminalCmds = () => [
    terminalCommand({
      id: "terminal.new",
      title: language.t("command.terminal.new"),
      description: language.t("command.terminal.new.description"),
      keybind: "ctrl+alt+t",
      onSelect: openTerminal,
    }),
  ]

  const messageCmds = () => [
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
  ]

  const modelCmds = () => [
    modelCommand({
      id: "model.choose",
      title: language.t("command.model.choose"),
      description: language.t("command.model.choose.description"),
      keybind: "mod+'",
      slash: "model",
      onSelect: chooseModel,
    }),
    modelCommand({
      id: "model.variant.cycle",
      title: language.t("command.model.variant.cycle"),
      description: language.t("command.model.variant.cycle.description"),
      keybind: "shift+mod+d",
      onSelect: () => local.model.variant.cycle(),
    }),
  ]

  const mcpCmds = () => [
    mcpCommand({
      id: "mcp.toggle",
      title: language.t("command.mcp.toggle"),
      description: language.t("command.mcp.toggle.description"),
      keybind: "mod+;",
      slash: "mcp",
      onSelect: chooseMcp,
    }),
  ]

  const agentCmds = () => [
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
  ]

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: isAutoAcceptActive()
        ? language.t("command.permissions.autoaccept.disable")
        : language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      disabled: false,
      onSelect: toggleAutoAccept,
    }),
  ]

  command.register("session", () => [
    ...sessionCmds(),
    ...shareCmds(),
    ...fileCmds(),
    ...contextCmds(),
    ...viewCmds(),
    ...terminalCmds(),
    ...messageCmds(),
    ...modelCmds(),
    ...mcpCmds(),
    ...agentCmds(),
    ...permissionsCmds(),
  ])
}
