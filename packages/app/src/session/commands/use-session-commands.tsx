import { useCommand, type CommandOption } from "@/shell/commands/command"
import { adjacentTabKey } from "@/shell/titlebar/tab-order"
import { useDialog } from "@opencode/ui/context/dialog"
import { previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection } from "@/workspaces/files/model"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { useComposerState } from "@/composer/persistence"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { showToast } from "@/shell/notifications/toast"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "@/session/commands/export"
import { usePlatform } from "@/runtime/platform/platform"
import type { SessionModel } from "@/session/model"
import type { SessionRevert } from "@/session/revert"
import { Command } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "@/runtime/extension/host"
import type { Region } from "@/runtime/extension/panels"

type SessionCommandSource = {
  identity: SessionModel["identity"]
  data: Pick<SessionModel["data"], "info" | "revertMessageID">
  history: Pick<SessionModel["history"], "visibleUserMessages">
  layout: SessionModel["layout"]
  ownership: SessionModel["ownership"]
}

export type SessionCommandContext = {
  session: SessionCommandSource
  region: Region
  background: {
    blocking: () => boolean
    move: () => Promise<void>
  }
  navigateMessageByOffset: (offset: number) => void
  revert: Pick<SessionRevert, "undo" | "redo">
  focusInput: () => void
  // The composer's model, which a compaction runs with.
  model: () => { id: string; providerID: string; variant?: string } | undefined
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
  const prompt = useComposerState()
  const serverSDK = useServerSDK()
  const data = useData()
  const settings = useSettings()
  const platform = usePlatform()
  const layout = useLayout()
  const host = useExtensionHost()

  const openDialog = async <T,>(load: () => Promise<T>, show: (value: T) => void) => {
    const owner = actions.session.ownership.capture()
    const value = await load()
    owner.run(() => show(value))
  }

  const shown = settings.visibility.fileTree

  // The file the selected side tab shows; other tabs have no line selection.
  const activeFile = () => actions.region.selected()?.tab.file

  // Pinned tabs stay open, and hidden side-panel tabs do not claim Close Tab while the region is collapsed.
  const closableTab = () => {
    if (!actions.session.layout.view().side.opened()) return

    const entry = actions.region.selected()

    return entry && !entry.tab.pinned ? entry.key : undefined
  }

  const cycleSideTabs = () => actions.session.layout.view().side.opened() && actions.region.keys().length > 1

  // Focus inside an extension command's scope belongs to that extension, which binds its own shortcuts there.
  const extensionScoped = (target: EventTarget | null) =>
    target instanceof Element &&
    host.items(Command).some((item) => !!item.value.scope && !!target.closest(item.value.scope))

  const sideFocused = (target: EventTarget | null) => {
    const element =
      target instanceof Element && target !== document.body && target !== document.documentElement
        ? target
        : document.activeElement

    return element instanceof Element && !!element.closest("#review-panel") && !extensionScoped(element)
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
    const path = activeFile()

    if (!path) return false

    return file.selectedLines(path) != null
  }

  const navigateMessageByOffset = actions.navigateMessageByOffset
  const focusInput = actions.focusInput

  const sessionCommand = withCategory(language.t("command.category.session"))
  const projectCommand = withCategory(language.t("command.category.project"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))

  const exportSession = async () => {
    const sessionID = actions.session.identity.params.id

    if (!sessionID) return

    try {
      const data = await fetchSessionExport({
        sessionID,
        api: serverSDK.api,
      })

      const filename = sessionExportFilename(data.info)

      if (!(await saveSessionExport(filename, data, platform))) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const copySessionID = async () => {
    const sessionID = actions.session.identity.params.id

    if (!sessionID) return

    try {
      await (platform.writeClipboardText?.(sessionID) ?? navigator.clipboard.writeText(sessionID))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("common.copied"),
        description: sessionID,
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.copyID.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.copyID.failed.description"),
      })
    }
  }

  const copyProjectID = async () => {
    const projectID = actions.session.data.info()?.projectID

    if (!projectID) return

    try {
      await (platform.writeClipboardText?.(projectID) ?? navigator.clipboard.writeText(projectID))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("common.copied"),
        description: projectID,
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.project.copyID.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.project.copyID.failed.description"),
      })
    }
  }

  const openFile = () => {
    void openDialog(
      () => import("@/shell/commands/dialog"),
      (x) => dialog.show(() => <x.DialogCommandPalette />),
    )
  }

  const closeTab = () => {
    const tab = closableTab()

    if (tab) actions.region.close(tab)
  }

  const selectAdjacentSideTab = (offset: -1 | 1) => {
    const key = adjacentTabKey(actions.region.keys(), actions.region.active(), offset)

    if (!key) return

    actions.region.select(key)

    const panel = document.getElementById("review-panel")

    if (!panel) return

    const active = document.activeElement

    if (
      active instanceof HTMLElement &&
      panel.contains(active) &&
      !active.closest('[role="tab"][aria-selected="false"], [inert], .hidden')
    )
      return
    ;(panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? panel).focus({ preventScroll: true })
  }

  const addSelection = () => {
    const path = activeFile()

    if (!path) return

    const range = file.selectedLines(path)

    if (!range) {
      showToast({
        title: language.t("toast.context.noLineSelection.title"),
        description: language.t("toast.context.noLineSelection.description"),
      })

      return
    }

    addSelectionToContext(path, selectionFromLines(range))
  }

  const chooseMcp = () => {
    void openDialog(
      () => import("@/providers/connect/mcp-dialog"),
      (x) => dialog.show(() => <x.DialogSelectMcp />),
    )
  }

  const sessionProject = () => projectSettingsKey(serverSDK.scope, actions.session.data.info()?.projectID)

  const autoAccepting = () => settings.permissions.autoApproves(sessionProject())

  // From a session the toggle sets this project's choice, falling back to the default when they match.
  const toggleAutoAccept = () => {
    const project = sessionProject()
    const active = !autoAccepting()

    if (!project) settings.permissions.setAutoApproveDefault(active)
    else
      settings.permissions.setAutoApproveOverride(
        project,
        active === settings.permissions.autoApproveDefault() ? undefined : active,
      )

    if (!active) {
      showToast({
        title: language.t("toast.permissions.autoaccept.off.title"),
        description: language.t("toast.permissions.autoaccept.off.description"),
      })

      return
    }

    showToast({
      title: project
        ? language.t("toast.permissions.autoaccept.project.title")
        : language.t("toast.permissions.autoaccept.on.title"),
      description: project
        ? language.t("toast.permissions.autoaccept.project.description")
        : language.t("toast.permissions.autoaccept.on.description"),
    })
  }

  const undo = actions.revert.undo
  const redo = actions.revert.redo

  const compact = async () => {
    const sessionID = actions.session.identity.params.id

    if (!sessionID) return

    await data.session.compact({ sessionID, model: actions.model() }).catch((cause: unknown) => {
      showToast({ title: formatServerError(cause, language.t, language.t("common.requestFailed")) })
    })
  }

  const fork = () => {
    const sessionID = actions.session.identity.params.id

    if (!sessionID) return
    void openDialog(
      () => import("@/session/commands/fork-dialog"),
      (x) => dialog.show(() => <x.DialogFork />),
    )
  }

  const sessionCmds = () => [
    sessionCommand({
      id: "session.new",
      title: language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: (source) => command.trigger("tab.new", source),
    }),
    sessionCommand({
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      slash: "undo",
      disabled: !actions.session.identity.params.id || actions.session.history.visibleUserMessages().length === 0,
      onSelect: undo,
    }),
    sessionCommand({
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      slash: "redo",
      disabled: !actions.session.identity.params.id || !actions.session.data.revertMessageID(),
      onSelect: redo,
    }),
    sessionCommand({
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      slash: "compact",
      disabled: !actions.session.identity.params.id || actions.session.history.visibleUserMessages().length === 0,
      onSelect: compact,
    }),
    sessionCommand({
      id: "session.background",
      title: language.t("command.session.background"),
      keybind: "ctrl+b",
      disabled: !actions.background.blocking(),
      onSelect: actions.background.move,
    }),
    sessionCommand({
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      slash: "fork",
      disabled: !actions.session.identity.params.id || actions.session.history.visibleUserMessages().length === 0,
      onSelect: fork,
    }),
    sessionCommand({
      id: "session.export",
      title: language.t("command.session.export"),
      description: language.t("command.session.export.description"),
      slash: "export",
      disabled: !actions.session.identity.params.id,
      onSelect: exportSession,
    }),
    sessionCommand({
      id: "session.copyID",
      title: language.t("command.session.copyID"),
      disabled: !actions.session.identity.params.id,
      onSelect: copySessionID,
    }),
  ]

  const fileCmds = () => {
    const tab = closableTab()
    const cycle = cycleSideTabs()

    return [
      fileCommand({
        id: "file.open",
        title: language.t("command.file.open"),
        description: language.t("palette.search.placeholder"),
        keybind: "mod+p",
        slash: "open",
        onSelect: openFile,
      }),
      tab &&
        fileCommand({
          id: "file.close",
          title: language.t("command.tab.close"),
          keybind: "mod+w",
          follows: "tab.close",
          when: (event) => !extensionScoped(event.target),
          onSelect: closeTab,
        }),
      cycle &&
        fileCommand({
          id: "file.tab.prev",
          title: "",
          keybind: settings.keybinds.get("tab.prev") ?? "mod+option+ArrowLeft,ctrl+shift+tab",
          hidden: true,
          when: (event) => sideFocused(event.target),
          onSelect: () => selectAdjacentSideTab(-1),
        }),
      cycle &&
        fileCommand({
          id: "file.tab.next",
          title: "",
          keybind: settings.keybinds.get("tab.next") ?? "mod+option+ArrowRight,ctrl+tab",
          hidden: true,
          when: (event) => sideFocused(event.target),
          onSelect: () => selectAdjacentSideTab(1),
        }),
    ].filter((v) => !!v)
  }

  const projectCmds = () => [
    projectCommand({
      id: "project.copyID",
      title: language.t("command.project.copyID"),
      disabled: !actions.session.data.info()?.projectID,
      onSelect: copyProjectID,
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
      id: "review.toggle",
      title: language.t("command.review.toggle"),
      keybind: "mod+shift+r",
      onSelect: () => actions.session.layout.view().side.toggle(),
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

  const messageCmds = () => [
    sessionCommand({
      id: "message.previous",
      title: language.t("command.message.previous"),
      description: language.t("command.message.previous.description"),
      keybind: "mod+alt+[",
      disabled: !actions.session.identity.params.id,
      onSelect: () => navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: language.t("command.message.next"),
      description: language.t("command.message.next.description"),
      keybind: "mod+alt+]",
      disabled: !actions.session.identity.params.id,
      onSelect: () => navigateMessageByOffset(1),
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

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: autoAccepting()
        ? language.t("command.permissions.autoaccept.disable")
        : sessionProject()
          ? language.t("command.permissions.autoaccept.project")
          : language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      disabled: false,
      onSelect: toggleAutoAccept,
    }),
  ]

  command.register("session", () => [
    ...sessionCmds(),
    ...projectCmds(),
    ...fileCmds(),
    ...contextCmds(),
    ...viewCmds(),
    ...messageCmds(),
    ...mcpCmds(),
    ...permissionsCmds(),
  ])
}
