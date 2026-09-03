import { Component, createMemo } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useData } from "@/runtime/server/current"
import { useComposerState } from "@/composer/persistence"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { showToast } from "@/shell/notifications/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { base64Encode } from "@opencode-ai/util/encode"
import { extractPromptComments, extractPromptFromMessage } from "@/composer/prompt"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServer } from "@/runtime/server/current"
import { sessionHref } from "@/shell/routes/session"

const fullSessionID = "__full__"

type ForkOption =
  | { kind: "full"; id: typeof fullSessionID; text: string }
  | { kind: "message"; id: string; text: string; time: string }

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export const DialogFork: Component = () => {
  const params = useParams()
  const navigate = useNavigate()
  const data = useData()
  const serverSDK = useServerSDK()
  const location = useWorkspaceLocation()
  const prompt = useComposerState()
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServer()

  const items = createMemo((): ForkOption[] => {
    const sessionID = params.id
    const full: ForkOption = { kind: "full", id: fullSessionID, text: language.t("dialog.fork.full") }
    if (!sessionID) return [full]

    const messages: ForkOption[] = []
    for (const message of data.session.message.list(sessionID)) {
      if (message.type !== "user" || !message.text) continue
      messages.push({
        kind: "message",
        id: message.id,
        text: message.text.replace(/\n/g, " ").slice(0, 200),
        time: formatTime(new Date(message.time.created)),
      })
    }
    return [full, ...messages.toReversed()]
  })

  const openForked = (forked: { id: string }) => {
    data.session.remember(forked)
    dialog.close()
    navigate(sessionHref(server.key, forked.id))
  }

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    showToast({ title: language.t("common.requestFailed"), description: message })
  }

  const handleSelect = (item: ForkOption | undefined) => {
    if (!item) return
    const sessionID = params.id
    if (!sessionID) return

    if (item.kind === "full") {
      serverSDK.api.session
        .fork({ sessionID, boundary: { type: "through" } })
        .then(openForked)
        .catch(fail)
      return
    }

    const message = data.session.message.get(sessionID, item.id)
    if (message?.type !== "user") return
    const restored = extractPromptFromMessage(message, {
      directory: location().directory,
      attachmentName: language.t("common.attachment"),
    })
    const dir = base64Encode(location().directory)

    serverSDK.api.session
      .fork({ sessionID, boundary: { type: "before", messageID: item.id } })
      .then((forked) => {
        const target = prompt.capture({ dir, id: forked.id })
        target.set(restored)
        target.context.replaceComments(
          extractPromptComments(message).map((comment) => ({
            type: "file",
            path: comment.path,
            selection: comment.selection,
            comment: comment.comment,
            preview: comment.preview,
            commentOrigin: comment.origin,
          })),
        )
        openForked(forked)
      })
      .catch(fail)
  }

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>{language.t("command.session.fork")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <List
          class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
          search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.fork.empty")}
          key={(x) => x.id}
          items={items}
          filterKeys={["text"]}
          skipFilter={(x) => x.kind === "full"}
          sortBy={(a, b) => Number(b.kind === "full") - Number(a.kind === "full")}
          onSelect={handleSelect}
        >
          {(item) =>
            item.kind === "full" ? (
              <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
            ) : (
              <div class="w-full flex items-center gap-2">
                <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
                <span class="text-text-weak shrink-0 font-normal">{item.time}</span>
              </div>
            )
          }
        </List>
      </DialogBody>
    </Dialog>
  )
}
