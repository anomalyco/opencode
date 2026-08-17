import type { Message, Part, UserMessage } from "@/types"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, on, type Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useTabs } from "@/context/tabs"
import type { SessionController } from "@/pages/session/session-controller"
import { legacySessionHref, requireServerKey, sessionHref } from "@/utils/session-route"
import { sessionTitle } from "@/utils/session-title"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { showToast } from "@/utils/toast"
import { timelineChildTitle, timelineRemovedSessionIDs } from "./controller-projection"
import { createTimelineProjection } from "./projection"
import { useServer } from "@/context/server"

const emptyMessages: Message[] = []
const emptyParts: Part[] = []
const taskDescription = (part: Part, sessionID: string): string | undefined => {
  if (part.type !== "tool" || part.tool !== "task") return undefined
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  if (metadata?.sessionId !== sessionID) return undefined
  const value = part.state.input?.description
  if (typeof value === "string" && value) return value
  return undefined
}

export type TimelineSessionSource = {
  identity: Pick<SessionController["identity"], "params" | "sessionID" | "sessionKey">
  data: Pick<SessionController["data"], "info" | "parent" | "parentID" | "status">
  history: Pick<SessionController["history"], "messages">
}

export function createTimelineController(input: {
  session: TimelineSessionSource
  userMessages: Accessor<UserMessage[]>
}) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const server = useServer()
  const settings = useSettings()
  const tabs = useTabs()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const projectedMessages = createMemo(() => {
    const id = input.session.identity.sessionID()
    if (!id) return []
    const visible = new Set(input.userMessages().map((message) => message.id))
    const boundary = input.session.history
      .messages()
      .find((message) => message.role === "user" && !visible.has(message.id))?.id
    const projected = sync().data.session_message[id] ?? []
    if (!boundary) return projected
    const index = projected.findIndex((message) => message.id === boundary)
    return index < 0 ? projected : projected.slice(0, index)
  })
  const titleValue = createMemo(() => input.session.data.info()?.title)
  const titleLabel = createMemo(() => sessionTitle(titleValue()))
  const shareUrl = (): string | undefined => undefined
  const shareEnabled = () => false
  const parentMessages = createMemo(() => {
    const id = input.session.data.parentID()
    return id ? (sync().data.message[id] ?? emptyMessages) : emptyMessages
  })
  const parentTitle = createMemo(
    () => sessionTitle(input.session.data.parent()?.title) ?? language.t("command.session.new"),
  )
  const parts = (messageID: string) => sync().data.part[messageID] ?? emptyParts
  const part = (messageID: string, partID: string) => parts(messageID).find((item) => item.id === partID)
  const childTaskDescription = createMemo(() => {
    const id = input.session.identity.sessionID()
    if (!id) return undefined
    return parentMessages()
      .flatMap((message) => parts(message.id))
      .map((item) => taskDescription(item, id))
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
    messages: input.session.history.messages,
    userMessages: input.userMessages,
    sessionMessages: projectedMessages,
    parts,
    status: input.session.data.status,
    showReasoningSummaries: settings.general.showReasoningSummaries,
    inlineComments: settings.general.newLayoutDesigns,
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
    const success = await sdk()
      .api.session.rename({ sessionID: id, title: next })
      .then(() => true)
      .catch((error) => {
        showToast({ title: language.t("common.requestFailed"), description: errorMessage(error) })
        return false
      })
    setPending("rename", false)
    if (!success) return false
    sync().set(
      produce((draft) => {
        const index = draft.session.findIndex((session) => session.id === id)
        if (index !== -1) draft.session[index].title = next
      }),
    )
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
  const href = (id: string) =>
    input.session.identity.params.serverKey
      ? sessionHref(requireServerKey(input.session.identity.params.serverKey), id)
      : legacySessionHref(sdk().directory, id)
  const navigateAfterRemoval = (id: string, parent?: string, next?: string) => {
    if (input.session.identity.params.id !== id) return
    if (parent) return navigate(href(parent))
    if (next) return navigate(href(next))
    if (input.session.identity.params.serverKey)
      return tabs.newDraft({
        server: requireServerKey(input.session.identity.params.serverKey),
        directory: sdk().directory,
      })
    navigate(`/${input.session.identity.params.dir}/session`)
  }
  const exportSession = async (id: string) => {
    try {
      const data = await fetchSessionExport({ sessionID: id, api: sdk().api })
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
    const session = sync().session.get(id)
    if (!session) return false
    const sessions = sync().data.session.filter((item) => !item.parentID && !item.time?.archived)
    const index = sessions.findIndex((item) => item.id === id)
    const next = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])
    const success = await sdk()
      .api.session.remove({ sessionID: id })
      .then(() => true)
      .catch((error) => {
        showToast({ title: language.t("session.delete.failed.title"), description: errorMessage(error) })
        return false
      })
    if (!success) return false
    const removed = timelineRemovedSessionIDs(sync().data.session, id)
    void navigateAfterRemoval(id, session.parentID, next?.id)
    sync().set(produce((draft) => void (draft.session = draft.session.filter((item) => !removed.has(item.id)))))
    removed.forEach((sessionID) => sync().session.evict(sessionID))
    notifySessionTabsRemoved({ server: server.key, directory: sdk().directory, sessionIDs: [...removed] })
    return true
  }

  function DeleteDialog(props: { sessionID: string }) {
    const name = createMemo(
      () => sessionTitle(sync().session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
    )
    const confirm = async () => {
      await remove(props.sessionID)
      dialog.close()
    }
    if (settings.general.newLayoutDesigns())
      return (
        <DialogV2 fit>
          <DialogHeader hideClose>
            <DialogTitleGroup
              title={language.t("session.delete.title")}
              description={language.t("session.delete.confirm", { name: name() })}
            />
          </DialogHeader>
          <DialogFooter>
            <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </ButtonV2>
            <ButtonV2 variant="danger" onClick={confirm}>
              {language.t("session.delete.button")}
            </ButtonV2>
          </DialogFooter>
        </DialogV2>
      )
    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={confirm}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  createEffect(
    on(
      () => [input.session.data.parentID(), childTaskDescription()] as const,
      ([id, description]) => {
        if (!id || description || sync().data.message[id] !== undefined) return
        void sync().session.sync(id)
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
      parts,
      part,
      projection,
      newLayoutDesigns: settings.general.newLayoutDesigns,
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
