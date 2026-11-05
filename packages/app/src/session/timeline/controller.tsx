import type { SessionMessageInfo } from "@opencode/client/promise"
import { DialogFooter, DialogHeader, DialogTitleGroup, Dialog } from "@opencode/ui/dialog"
import { Button } from "@opencode/ui/button"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from "solid-js"
import { Option, Predicate, Schema } from "effect"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useTabs } from "@/shell/tabs/tabs"
import type { SessionModel } from "@/session/model"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { useServerSDK } from "@/runtime/server/client"
import { sessionHref } from "@/shell/routes/session"
import { sessionTitle } from "@/session/title"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "@/session/commands/export"
import { showToast } from "@/shell/notifications/toast"
import { usePlatform } from "@/runtime/platform/platform"
import { applyTimelineMessageHandoff, timelineChildTitle, visibleTimelineMessages } from "./controller-projection"
import {
  createSessionDeleteState,
  createSessionHeaderTitleState,
  selectSessionDeleteView,
  selectSessionHeaderTitleView,
  SESSION_DELETE_TIMEOUT_MS,
  SESSION_RENAME_TIMEOUT_MS,
  transitionSessionDelete,
  transitionSessionHeaderTitle,
  type SessionDeleteEffect,
  type SessionDeleteEvent,
  type SessionHeaderTitleEffect,
  type SessionHeaderTitleEvent,
} from "./header-actions-machine"
import { createTimelineProjection } from "./projection"
import { useServer } from "@/runtime/server/current"
import type { ReasoningMode } from "@opencode/session-ui/timeline/projection"

const emptyMessages: SessionMessageInfo[] = []

const decodeErrorData = Schema.decodeUnknownOption(Schema.Struct({ data: Schema.Struct({ message: Schema.String }) }))

const taskDescription = (message: SessionMessageInfo, sessionID: string): string | undefined => {
  if (message.type !== "assistant") return

  const tool = message.content.findLast((item) => {
    if (item.type !== "tool" || (item.name !== "task" && item.name !== "subagent")) return false

    const metadata =
      item.state.status === "running" || item.state.status === "completed" ? item.state.metadata : undefined

    return metadata?.sessionId === sessionID || metadata?.sessionID === sessionID
  })

  if (tool?.type !== "tool") return
  const input = Predicate.isString(tool.state.input) ? undefined : tool.state.input
  const value = input?.description

  if (Predicate.isString(value) && value) return value

  return undefined
}

export type TimelineSessionSource = {
  identity: Pick<SessionModel["identity"], "params" | "sessionID" | "sessionKey">
  data: Pick<SessionModel["data"], "info" | "parent" | "parentID" | "status">
  history: Pick<SessionModel["history"], "messages">
}

export function createTimelineController(input: { session: TimelineSessionSource; active: Accessor<boolean> }) {
  const navigate = useNavigate()
  const sdk = useWorkspaceLocation()
  const serverSDK = useServerSDK()
  const server = useServer()
  const data = server.ctx.data
  const settings = useSettings()
  const tabs = useTabs()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()

  // Pending inputs and the handoff hold with the history while the view is detached, so a hidden view never shows
  // one against history it has not caught up with.
  const pendingItems = createMemo<{ value: ReturnType<typeof data.session.pending.list> } | undefined>(
    (previous) => {
      if (previous && !input.active()) return previous
      const id = input.session.identity.sessionID()

      return { value: id ? data.session.pending.list(id) : [] }
    },
    undefined,
    { equals: (previous, next) => previous?.value === next?.value },
  )

  const pendingList = () => pendingItems()!.value

  const handoffItem = createMemo<{ value: ReturnType<typeof server.ctx.handoff.get> } | undefined>(
    (previous) => {
      if (previous && !input.active()) return previous

      return { value: server.ctx.handoff.get(input.session.identity.sessionID()) }
    },
    undefined,
    { equals: (previous, next) => previous?.value === next?.value },
  )

  const visibleMessages = createMemo(() =>
    visibleTimelineMessages(
      input.session.history.messages(),
      pendingList(),
      input.session.data.info()?.revert?.messageID,
    ),
  )

  // A handoff projects after visibility: its prompt commits any staged revert, so the boundary does not hide it.
  const projectedMessages = createMemo(() =>
    applyTimelineMessageHandoff(visibleMessages(), handoffItem()!.value, input.session.data.info()),
  )

  // Inputs that wait behind the active turn. A starting steer opens the next turn instead, so the turn before it
  // stays finished, as it will once the steer is delivered.
  const pendingInputIDs = createMemo(() => {
    const id = input.session.identity.sessionID()

    if (!id) return new Set<string>()

    return new Set(
      pendingList().flatMap((item) =>
        (item.type === "user" &&
          item.delivery === "steer" &&
          data.session.pending.status(id, item.id) !== "starting") ||
        item.type === "synthetic"
          ? [item.id]
          : [],
      ),
    )
  })

  const queuedCompactionIDs = createMemo(() =>
    pendingList().flatMap((item) => (item.type === "compaction" ? [item.id] : [])),
  )

  const titleValue = createMemo(() => input.session.data.info()?.title)
  const titleLabel = createMemo(() => sessionTitle(titleValue()) ?? language.t("session.tab.session"))

  const parentMessages = createMemo(() => {
    const id = input.session.data.parentID()

    return id ? data.session.message.list(id) : emptyMessages
  })

  const parentTitle = createMemo(
    () => sessionTitle(input.session.data.parent()?.title) ?? language.t("session.tab.session"),
  )

  const childTaskDescription = createMemo(() => {
    const id = input.session.identity.sessionID()

    if (!id) return undefined

    return parentMessages()
      .map((message) => taskDescription(message, id))
      .findLast((value): value is string => !!value)
  })

  const childTitle = createMemo(() => {
    return timelineChildTitle({
      parentID: input.session.data.parentID(),
      taskDescription: childTaskDescription(),
      title: titleLabel(),
      fallback: language.t("session.tab.session"),
    })
  })

  const showHeader = createMemo(() => !!input.session.identity.sessionID())

  const timelineDetail = createMemo(() => {
    const detail = settings.general.timelineDetail()

    return {
      shell: { ...detail.shell },
      edit: { ...detail.edit },
      thinking: { ...detail.thinking },
      subagents: { ...detail.subagents },
      notices: { ...detail.notices },
      tools: { ...detail.tools },
      commentary: { ...detail.commentary },
    }
  })

  const reasoningMode = (): ReasoningMode =>
    timelineDetail().thinking.placement === "hidden"
      ? "hidden"
      : timelineDetail().thinking.details === "expanded"
        ? "full"
        : "compact"

  const shellToolPartsExpanded = () => timelineDetail().shell.details === "expanded"
  const editToolPartsExpanded = () => timelineDetail().edit.details === "expanded"

  const projection = createTimelineProjection({
    sessionMessages: projectedMessages,
    status: input.session.data.status,
    reasoningMode,
    shellToolDefaultOpen: shellToolPartsExpanded,
    editToolDefaultOpen: editToolPartsExpanded,
    timelineDetail,
    pendingInputIDs,
    queuedCompactionIDs,
    turnDiffs: settings.general.showTurnDiffs,
  })

  const errorMessage = (cause: unknown) =>
    Option.match(decodeErrorData(cause), {
      onSome: (error) => error.data.message,
      onNone: () => (cause instanceof Error ? cause.message : language.t("common.requestFailed")),
    })

  const editable = () =>
    !!input.session.identity.sessionID() && !input.session.data.parentID() && input.active()

  const [titleState, setTitleState] = createSignal(
    createSessionHeaderTitleState(untrack(input.session.identity.sessionKey)),
  )
  let titleInput: HTMLInputElement | undefined
  let titleTimer: ReturnType<typeof setTimeout> | undefined
  let titleFrame = 0

  const dispatchTitle = (event: SessionHeaderTitleEvent) => {
    const next = transitionSessionHeaderTitle(untrack(titleState), event)

    if (next.state !== untrack(titleState)) setTitleState(next.state)
    next.effects.forEach(runTitle)
  }

  function runTitle(effect: SessionHeaderTitleEffect) {
    if (effect.type === "focus.schedule") {
      cancelAnimationFrame(titleFrame)
      titleFrame = requestAnimationFrame(() => {
        const state = untrack(titleState)

        if (state.status !== "editing" || state.attempt !== effect.attempt) return
        titleInput?.focus()
        titleInput?.select()
      })

      return
    }

    if (effect.type === "focus.cancel") return cancelAnimationFrame(titleFrame)

    if (effect.type === "rename.save") {
      // The session list takes the new title whenever the server saved it, even once the editor has gone.
      void Promise.try(() => serverSDK.api.session.update({ sessionID: effect.sessionID, title: effect.title })).then(
        () => {
          const current = data.session.get(effect.sessionID)

          if (current) data.session.remember({ ...current, title: effect.title })
          dispatchTitle({ type: "rename.succeeded", attempt: effect.attempt })
        },
        (cause: unknown) => dispatchTitle({ type: "rename.failed", attempt: effect.attempt, cause }),
      )

      return
    }

    if (effect.type === "toast.rename-failed")
      return showToast({
        title: language.t("common.requestFailed"),
        description: effect.cause === undefined ? undefined : errorMessage(effect.cause),
      })

    clearTimeout(titleTimer)
    titleTimer = undefined

    if (effect.type === "timer.cancel") return
    titleTimer = setTimeout(
      () => dispatchTitle({ type: "rename.timed-out", attempt: effect.attempt }),
      SESSION_RENAME_TIMEOUT_MS,
    )
  }

  createEffect(() =>
    dispatchTitle({ type: "target.synced", sessionKey: input.session.identity.sessionKey(), editable: editable() }),
  )
  onCleanup(() => dispatchTitle({ type: "disposed" }))

  const href = (id: string) => sessionHref(server.key, id)

  const navigateAfterRemoval = (id: string, parent?: string, next?: string) => {
    if (input.session.identity.params.id !== id) return

    if (parent) return navigate(href(parent))

    if (next) return navigate(href(next))

    return tabs.newDraft({ server: server.key, directory: sdk().directory })
  }

  const exportSession = async (id: string) => {
    try {
      const data = await fetchSessionExport({ sessionID: id, api: serverSDK.api })
      const filename = sessionExportFilename(data.info)

      if (!(await saveSessionExport(filename, data, platform))) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: error instanceof Error ? error.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  // Where the view goes once the session is gone, read before the delete hides it from the list.
  const deleteTarget = (id: string) => {
    const session = data.session.get(id)

    if (!session) return
    const sessions = data.session.list().filter((item) => !item.parentID && !item.time?.archived)
    const index = sessions.findIndex((item) => item.id === id)
    const next = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    return { parentID: session.parentID, nextID: next?.id, removedIDs: sessionTreeIDs(data.session.list(), id) }
  }

  function DeleteDialog(props: { sessionID: string }) {
    const name = createMemo(
      () => sessionTitle(data.session.get(props.sessionID)?.title) ?? language.t("session.tab.session"),
    )

    const [deleteState, setDeleteState] = createSignal(createSessionDeleteState(props.sessionID))
    let timer: ReturnType<typeof setTimeout> | undefined

    const dispatch = (event: SessionDeleteEvent) => {
      const next = transitionSessionDelete(untrack(deleteState), event)

      if (next.state !== untrack(deleteState)) setDeleteState(next.state)
      next.effects.forEach(run)
    }

    function run(effect: SessionDeleteEffect) {
      if (effect.type === "delete.run") {
        void Promise.try(() => data.session.remove(effect.sessionID)).then(
          () => dispatch({ type: "delete.succeeded", attempt: effect.attempt, target: effect.target }),
          (cause: unknown) => dispatch({ type: "delete.failed", attempt: effect.attempt, cause }),
        )

        return
      }

      if (effect.type === "dialog.close") return dialog.close()

      if (effect.type === "session.removed") {
        void navigateAfterRemoval(effect.sessionID, effect.target.parentID, effect.target.nextID)
        notifySessionTabsRemoved({
          server: server.key,
          directory: sdk().directory,
          sessionIDs: [...effect.target.removedIDs],
        })

        return
      }

      if (effect.type === "toast.delete-failed")
        return showToast({
          title: language.t("session.delete.failed.title"),
          description: effect.cause === undefined ? undefined : errorMessage(effect.cause),
        })

      clearTimeout(timer)
      timer = undefined

      if (effect.type === "timer.cancel") return
      timer = setTimeout(() => dispatch({ type: "delete.timed-out", attempt: effect.attempt }), SESSION_DELETE_TIMEOUT_MS)
    }

    onCleanup(() => dispatch({ type: "disposed" }))
    const busy = () => selectSessionDeleteView(deleteState()).busy

    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: name() })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" autofocus disabled={busy()} onClick={() => dispatch({ type: "cancel.requested" })}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={busy()}
            onClick={() => dispatch({ type: "confirm.requested", target: deleteTarget(props.sessionID) })}
          >
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  createEffect(
    on(
      () => [input.session.data.parentID(), childTaskDescription()] as const,
      ([id, description]) => {
        if (!id || description || data.session.message.list(id).length > 0) return
        void Promise.all([data.session.sync(id), data.session.message.sync(id)])
      },
      { defer: true },
    ),
  )

  return {
    data: {
      sessionKey: input.session.identity.sessionKey,
      sessionID: input.session.identity.sessionID,
      status: input.session.data.status,
      titleValue,
      titleLabel,
      parentID: input.session.data.parentID,
      parentTitle,
      childTitle,
      showHeader,
      projection,
      timelineDetail,
      reasoningMode,
      shellToolPartsExpanded,
      editToolPartsExpanded,
    },
    title: {
      view: createMemo(() => selectSessionHeaderTitleView(titleState())),
      setInput: (element: HTMLInputElement) => {
        titleInput = element
      },
      toggleMenu: (open: boolean) => dispatchTitle({ type: "menu.toggled", open, editable: editable() }),
      edit: () => dispatchTitle({ type: "edit.opened", editable: editable(), title: titleLabel() }),
      change: (value: string) => dispatchTitle({ type: "draft.changed", value }),
      cancel: () => dispatchTitle({ type: "edit.cancelled" }),
      submit: () =>
        dispatchTitle({
          type: "edit.submitted",
          sessionID: input.session.identity.sessionID(),
          editable: editable(),
          currentTitle: titleLabel(),
        }),
    },
    action: {
      export: exportSession,
      showDelete: (id: string) => dialog.show(() => <DeleteDialog sessionID={id} />),
      navigateParent: () => {
        const id = input.session.data.parentID()

        if (id) navigate(href(id))
      },
    },
  }
}

export type TimelineController = ReturnType<typeof createTimelineController>
