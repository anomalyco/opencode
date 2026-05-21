import { Component, createMemo } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { showToast } from "@opencode-ai/ui/toast"
import { extractPromptFromParts } from "@/utils/prompt"
import type { TextPart as SDKTextPart } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLanguage } from "@/context/language"

interface ForkableMessage {
  id: string
  // The messageID to pass to the fork API (exclusive cutoff = next message's id)
  cutoffID: string | undefined
  text: string
  time: string
  role: "user" | "assistant"
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export const DialogFork: Component = () => {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const sdk = useSDK()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()

  const messages = createMemo((): ForkableMessage[] => {
    const sessionID = params.id
    if (!sessionID) return []

    const msgs = sync.data.message[sessionID] ?? []
    const result: ForkableMessage[] = []

    for (let i = 0; i < msgs.length; i++) {
      const message = msgs[i]
      if (message.role !== "user" && message.role !== "assistant") continue

      const parts = sync.data.part[message.id] ?? []
      const textPart = parts.find((x): x is SDKTextPart => x.type === "text" && !x.synthetic && !x.ignored)
      if (!textPart) continue

      // For user messages: cutoff = user message id (exclusive, drops the user message itself — original behavior)
      // For assistant messages: cutoff = the *next* message's id (exclusive), so the assistant message is included.
      //   If there's no next message, cutoffID = undefined meaning fork everything (also correct).
      const cutoffID = message.role === "user" ? message.id : msgs[i + 1]?.id

      result.push({
        id: message.id,
        cutoffID,
        role: message.role,
        text: textPart.text.replace(/\n/g, " ").slice(0, 200),
        time: formatTime(new Date(message.time.created)),
      })
    }

    return result.reverse()
  })

  const handleSelect = (item: ForkableMessage | undefined) => {
    if (!item) return

    const sessionID = params.id
    if (!sessionID) return

    const dir = base64Encode(sdk.directory)

    sdk.client.session
      .fork({ sessionID, messageID: item.cutoffID })
      .then((forked) => {
        if (!forked.data) {
          showToast({ title: language.t("common.requestFailed") })
          return
        }
        dialog.close()
        if (item.role === "user") {
          const parts = sync.data.part[item.id] ?? []
          const restored = extractPromptFromParts(parts, {
            directory: sdk.directory,
            attachmentName: language.t("common.attachment"),
          })
          prompt.set(restored, undefined, { dir, id: forked.data.id })
        }
        navigate(`/${dir}/session/${forked.data.id}`)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <Dialog title={language.t("command.session.fork")}>
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.fork.empty")}
        key={(x) => x.id}
        items={messages}
        filterKeys={["text"]}
        onSelect={handleSelect}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            {item.role === "assistant" && (
              <span class="text-text-weak shrink-0 font-normal text-xs">[assistant]</span>
            )}
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
            <span class="text-text-weak shrink-0 font-normal">{item.time}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
