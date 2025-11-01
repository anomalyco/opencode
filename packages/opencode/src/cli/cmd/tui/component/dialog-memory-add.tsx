import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import path from "path"

interface Memory {
  id: string
  content: string
  embedding: number[]
  metadata: {
    type: "fact" | "preference" | "context" | "learning"
    timestamp: number
    tags?: string[]
    importance?: number
  }
}

interface MemoryStore {
  memories: Memory[]
  version: string
  lastUpdated: number
}

const MEMORY_FILE = ".opencode/memory.json"

async function saveMemory(memory: Memory): Promise<void> {
  try {
    const file = Bun.file(MEMORY_FILE)
    let store: MemoryStore

    if (await file.exists()) {
      store = (await file.json()) as MemoryStore
    } else {
      store = {
        memories: [],
        version: "1.0.0",
        lastUpdated: Date.now(),
      }
    }

    store.memories.push(memory)
    store.lastUpdated = Date.now()

    const dir = path.dirname(MEMORY_FILE)
    await Bun.$`mkdir -p ${dir}`.quiet()
    await Bun.write(MEMORY_FILE, JSON.stringify(store, null, 2))
  } catch (error) {
    console.error("Failed to save memory:", error)
    throw error
  }
}

export function DialogMemoryAdd(props: { onSave?: (memory: Memory) => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const [step, setStep] = createSignal<"content" | "type" | "importance" | "tags">("content")
  const [content, setContent] = createSignal("")
  const [type, setType] = createSignal<Memory["metadata"]["type"]>("fact")
  const [importance, setImportance] = createSignal(5)
  const [tags, setTags] = createSignal<string[]>([])

  const saveAndClose = async () => {
    const memory: Memory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      content: content(),
      embedding: [],
      metadata: {
        type: type(),
        timestamp: Date.now(),
        tags: tags().length > 0 ? tags() : undefined,
        importance: importance(),
      },
    }

    await saveMemory(memory)
    props.onSave?.(memory)
    dialog.clear()
  }

  return (
    <>
      {step() === "content" && (
        <DialogPrompt
          title="Add Memory"
          onConfirm={(value: string) => {
            setContent(value)
            setStep("type")
          }}
          onCancel={() => dialog.clear()}
        />
      )}

      {step() === "type" && (
        <DialogSelect
          title="Memory Type"
          options={[
            {
              title: "📚 Fact",
              value: "fact",
              footer: "General knowledge",
              category: "Type",
            },
            {
              title: "⚙️ Preference",
              value: "preference",
              footer: "User preferences",
              category: "Type",
            },
            {
              title: "📝 Context",
              value: "context",
              footer: "Contextual information",
              category: "Type",
            },
            {
              title: "💡 Learning",
              value: "learning",
              footer: "Things learned",
              category: "Type",
            },
          ]}
          onSelect={(option) => {
            setType(option.value as Memory["metadata"]["type"])
            setStep("importance")
          }}
        />
      )}

      {step() === "importance" && (
        <DialogSelect
          title="Importance"
          options={Array.from({ length: 10 }, (_, i) => {
            const level = i + 1
            return {
              title: `${level}/10 ${"★".repeat(level)}${"☆".repeat(10 - level)}`,
              value: level.toString(),
              category: "Importance",
            }
          })}
          onSelect={(option) => {
            setImportance(parseInt(option.value))
            setStep("tags")
          }}
        />
      )}

      {step() === "tags" && (
        <DialogPrompt
          title="Tags (optional)"
          onConfirm={(value: string) => {
            if (value && value.trim()) {
              setTags(value.split(",").map((t: string) => t.trim()))
            }
            saveAndClose()
          }}
          onCancel={() => {
            saveAndClose()
          }}
        />
      )}
    </>
  )
}
