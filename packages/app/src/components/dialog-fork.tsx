import { Component, createMemo } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { showToast } from "@opencode-ai/ui/toast"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { extractPromptFromParts } from "@/utils/prompt"
import type { TextPart as SDKTextPart } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/util/encode"
import { useLanguage } from "@/context/language"

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
  const navigate = useNavigate()
  const file = useFile()
  const layout = useLayout()
  const sync = useSync()
  const local = useLocal()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const { tabs } = useSessionLayout()

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const normalizeTabs = (list: string[]) => {
    const seen = new Set<string>()
    const next: string[] = []
    for (const item of list) {
      const value = normalizeTab(item)
      if (seen.has(value)) continue
      seen.add(value)
      next.push(value)
    }
    return next
  }

  const preview = (value: ReturnType<typeof extractPromptFromParts>) => {
    const text = value
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const seed = (next: NonNullable<ReturnType<typeof sync.session.get>>) => {
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === next.id)
      if (idx >= 0) {
        const out = list.slice()
        out[idx] = next
        return out
      }

      const out = list.slice()
      const at = out.findIndex((item) => item.id > next.id)
      if (at >= 0) {
        out.splice(at, 0, next)
        return out
      }

      out.push(next)
      return out
    })
  }

  const messages = createMemo((): ForkableMessage[] => {
    const sessionID = params.id
    if (!sessionID) return []

    const msgs = sync.data.message[sessionID] ?? []
    const result: ForkableMessage[] = []

    for (const message of msgs) {
      if (message.role !== "user") continue

      const parts = sync.data.part[message.id] ?? []
      const textPart = parts.find((x): x is SDKTextPart => x.type === "text" && !x.synthetic && !x.ignored)
      if (!textPart) continue

      result.push({
        id: message.id,
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

    const parts = sync.data.part[item.id] ?? []
    const restored = extractPromptFromParts(parts, {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })
    const dir = base64Encode(sdk.directory)

    sdk.client.session
      .fork({ sessionID, messageID: item.id })
      .then((forked) => {
        const next = forked.data
        if (!next) {
          showToast({ title: language.t("common.requestFailed") })
          return
        }
        const key = `${dir}/${next.id}`
        const all = normalizeTabs(tabs().all())
        const active = tabs().active()
        const nextTabs = layout.tabs(key)

        nextTabs.setAll(all)
        nextTabs.setActive(active ? normalizeTab(active) : all[0])
        local.session.promote(sdk.directory, next.id)
        seed(next)
        setSessionHandoff(key, {
          prompt: preview(restored),
          draft: restored,
          files: all.reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
            const path = file.pathFromTab(tab)
            if (!path) return acc

            const selected = file.selectedLines(path)
            acc[path] =
              selected && typeof selected === "object" && "start" in selected && "end" in selected
                ? (selected as SelectedLineRange)
                : null
            return acc
          }, {}),
        })
        dialog.close()
        navigate(`/${dir}/session/${next.id}`)
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
            <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
            <span class="text-text-weak shrink-0 font-normal">{item.time}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
