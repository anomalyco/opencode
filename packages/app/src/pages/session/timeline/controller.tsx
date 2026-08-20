import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { DialogFooter, DialogHeader, DialogTitleGroup, Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, on } from "solid-js"
import { createStore } from "solid-js/store"
import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useWorkspaceLocation } from "@/context/location"
import { useTabs } from "@/context/tabs"
import type { SessionController } from "@/pages/session/session-controller"
import { useServerSDK } from "@/context/server-sdk"
import { sessionHref } from "@/utils/session-route"
import { sessionTitle } from "@/utils/session-title"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { showToast } from "@/utils/toast"
import { timelineChildTitle, timelineRemovedSessionIDs, visibleTimelineMessages } from "./controller-projection"
import { createTimelineProjection } from "./projection"
import { useServer } from "@/context/server"

const emptyMessages: SessionMessageInfo[] = []
const taskDescription = (message: SessionMessageInfo, sessionID: string): string | undefined => {
  if (message.type !== "assistant") return
  const tool = message.content.findLast((item) => {
    if (item.type !== "tool" || (item.name !== "task" && item.name !== "subagent")) return false
    const metadata =
      item.state.status === "running" || item.state.status === "completed" ? item.state.metadata : undefined
    return metadata?.sessionId === sessionID || metadata?.sessionID === sessionID
  })
  if (tool?.type !== "tool") return
  const input = typeof tool.state.input === "string" ? undefined : tool.state.input
  const value = input?.description
  if (typeof value === "string" && value) return value
  return undefined
}

export type TimelineSessionSource = {
  identity: Pick<SessionController["identity"], "params" | "sessionID" | "sessionKey">
  data: Pick<SessionController["data"], "info" | "parent" | "parentID" | "status">
  history: Pick<SessionController["history"], "messages">
}

export function createTimelineController(input: { session: TimelineSessionSource }) {
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
  const projectedMessages = createMemo(() => {
    const id = input.session.identity.sessionID()
    return visibleTimelineMessages(
      input.session.history.messages(),
      id ? data.session.pending.list(id) : [],
      input.session.data.info()?.revert?.messageID,
    )
  })
  const titleValue = createMemo(() => input.session.data.info()?.title)
  const titleLabel = createMemo(() => sessionTitle(titleValue()) ?? language.t("command.session.new"))
  const shareUrl = (): string | undefined => undefined
  const shareEnabled = () => false
  const parentMessages = createMemo(() => {
    const id = input.session.data.parentID()
    return id ? data.session.message.list(id) : emptyMessages
  })
  const parentTitle = createMemo(
    () => sessionTitle(input.session.data.parent()?.title) ?? language.t("command.session.new"),
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
      fallback: language.t("command.session.new"),
    })
  })
  const showHeader = createMemo(() => !!input.session.identity.sessionID())
  const projection = createTimelineProjection({
    sessionMessages: projectedMessages,
    status: input.session.data.status,
    showReasoningSummaries: settings.general.showReasoningSummaries,
  })
  const [pending, setPending] = createStore({ rename: false, share: false, unshare: false })

  const errorMessage = (error: unknown) => {
    if (error && typeof error === "object" && "data" in error) {
      const data = error.data
      if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message
    }
    if (error instanceof Error) return error.message
    return language.t("common.requestFailed")
  }
  const rename = async (title: string) => {
    const id = input.session.identity.sessionID()
    if (!id || pending.rename) return false
    const next = title.trim()
    if (!next || next === (titleLabel() ?? "")) return true
    setPending("rename", true)
    const success = await serverSDK.api.session
      .rename({ sessionID: id, title: next })
      .then(() => true)
      .catch((error) => {
        showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) })
        return false
      })
    setPending("rename", false)
    if (!success) return false
    const current = data.session.get(id)
    if (current) data.session.remember({ ...current, title: next })
    return true
  }
  const share = async () => {
    const id = input.session.identity.sessionID()
    if (!id || pending.share || !shareEnabled()) return
  }
  const unshare = async () => {
    const id = input.session.identity.sessionID()
    if (!id || pending.unshare || !shareEnabled()) return
  }
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
      downloadSessionExport(filename, data)
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
  const remove = async (id: string) => {
    const session = data.session.get(id)
    if (!session) return false
    const sessions = data.session.list().filter((item) => !item.parentID && !item.time?.archived)
    const index = sessions.findIndex((item) => item.id === id)
    const next = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])
    const success = await serverSDK.api.session
      .remove({ sessionID: id })
      .then(() => true)
      .catch((error) => {
        showToast({ title: language.t("session.delete.failed.title"), description: errorMessage(error) })
        return false
      })
    if (!success) return false
    const removed = timelineRemovedSessionIDs(data.session.list(), id)
    void navigateAfterRemoval(id, session.parentID, next?.id)
    notifySessionTabsRemoved({ server: server.key, directory: sdk().directory, sessionIDs: [...removed] })
    return true
  }

  function DeleteDialog(props: { sessionID: string }) {
    const name = createMemo(
      () => sessionTitle(data.session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
    )
    const confirm = async () => {
      await remove(props.sessionID)
      dialog.close()
    }
    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: name() })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
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
      shareUrl,
      shareEnabled,
      parentID: input.session.data.parentID,
      parentTitle,
      childTitle,
      showHeader,
      projection,
      showReasoningSummaries: settings.general.showReasoningSummaries,
      shellToolPartsExpanded: settings.general.shellToolPartsExpanded,
      editToolPartsExpanded: settings.general.editToolPartsExpanded,
    },
    pending: {
      rename: () => pending.rename,
      share: () => pending.share,
      unshare: () => pending.unshare,
    },
    action: {
      rename,
      share,
      unshare,
      export: exportSession,
      showDelete: (id: string) => dialog.show(() => <DeleteDialog sessionID={id} />),
      navigateParent: () => {
        const id = input.session.data.parentID()
        if (id) navigate(href(id))
      },
      viewShare: () => {
        const url = shareUrl()
        if (url) platform.openExternal(url)
      },
      copyShareUrl: async () => {
        const url = shareUrl()
        if (!url) return
        await navigator.clipboard.writeText(url).then(
          () =>
            showToast({
              variant: "success",
              icon: "circle-check",
              title: language.t("session.share.copy.copied"),
              description: url,
            }),
          (error) => showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) }),
        )
      },
    },
  }
}

export type TimelineController = ReturnType<typeof createTimelineController>
