import { Component, createMemo } from "solid-js"
import { useParams } from "@solidjs/router"
import { useData } from "@/runtime/server/current"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { List } from "@opencode/ui/list"
import { useLanguage } from "@/runtime/i18n/language"
import { createSessionFork } from "../revert"

interface ForkableMessage {
  id: string
  text: string
  time: string
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export const DialogFork: Component = () => {
  const params = useParams()
  const data = useData()
  const dialog = useDialog()
  const language = useLanguage()
  const fork = createSessionFork()

  const messages = createMemo((): ForkableMessage[] => {
    const sessionID = params.id

    if (!sessionID) return []

    const msgs = data.session.message.list(sessionID)
    const result: ForkableMessage[] = []

    for (const message of msgs) {
      if (message.type !== "user" || !message.text) continue

      result.push({
        id: message.id,
        text: message.text.replace(/\n/g, " ").slice(0, 200),
        time: formatTime(new Date(message.time.created)),
      })
    }

    return result.reverse()
  })

  const handleSelect = (item: ForkableMessage | undefined) => {
    if (!item) return

    const sessionID = params.id

    if (!sessionID) return

    void fork.forkSessionAt(sessionID, item.id, {
      onForked: () => dialog.close(),
    })
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
          items={messages}
          filterKeys={["text"]}
          onSelect={handleSelect}
        >
          {(item) => (
            <div class="w-full flex items-center gap-2">
              <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
              <span class="text-text-weak shrink-0 font-normal">{item.time}</span>
            </div>
          )}
        </List>
      </DialogBody>
    </Dialog>
  )
}
