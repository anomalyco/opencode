import { TextAttributes } from "@opentui/core"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { createResource, createMemo, createSignal } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { Database } from "bun:sqlite"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import fs from "fs"

export type MemoryOption = {
  id: string
  title: string
  content: string
  category: string
  tags: string[]
  time_created: number
}

export type DialogMemoryProps = {
  onSelect: (item: MemoryOption) => void
}

function loadMemories(): MemoryOption[] {
  const dbPath = path.join(Global.Path.data, "memory.db")
  if (!fs.existsSync(dbPath)) return []

  try {
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare(`
      SELECT id, title, content, category, tags, time_created
      FROM memory
      ORDER BY time_created DESC
      LIMIT 100
    `).all() as any[]
    db.close()

    return rows.map((r) => {
      let tags: string[] = []
      if (typeof r.tags === "string") {
        try {
          tags = JSON.parse(r.tags)
        } catch {
          tags = []
        }
      }
      return {
        id: String(r.id),
        title: String(r.title),
        content: String(r.content),
        category: String(r.category || "general"),
        tags,
        time_created: Number(r.time_created),
      }
    })
  } catch {
    return []
  }
}

export function DialogMemory(props: DialogMemoryProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  dialog.setSize("large")

  const [loadError, setLoadError] = createSignal<unknown>()

  const [memories] = createResource(() =>
    Promise.resolve()
      .then(() => loadMemories())
      .catch((error) => {
        setLoadError(error)
        return []
      }),
  )

  const showError = createMemo(() => Boolean(loadError()))

  const options = createMemo<DialogSelectOption<MemoryOption>[]>(() => {
    if (showError()) return []
    const list = memories() ?? []
    const maxWidth = Math.max(0, ...list.map((m) => m.title.length))

    return list.map((item) => {
      const preview = item.content.replace(/\s+/g, " ").trim()
      const truncated = preview.length > 70 ? preview.slice(0, 67) + "..." : preview
      return {
        title: item.title.padEnd(Math.min(maxWidth, 45)),
        description: `[${item.category}] ${truncated}`,
        value: item,
        category: item.category.toUpperCase(),
        onSelect: () => {
          props.onSelect(item)
          dialog.clear()
        },
      }
    })
  })

  return (
    <DialogSelect
      title="Long-Term Memories"
      placeholder="Search memories (use /teach, /recall, /learn, /memory)…"
      options={options()}
      renderFilter={!showError()}
      locked={showError()}
      emptyView={
        showError() ? (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              Could not load memories
            </text>
            <text fg={theme.textMuted}>{errorMessage(loadError())}</text>
          </box>
        ) : (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.textMuted}>
              No saved memories found. Type /teach &lt;context&gt; to add your first memory!
            </text>
          </box>
        )
      }
    />
  )
}
