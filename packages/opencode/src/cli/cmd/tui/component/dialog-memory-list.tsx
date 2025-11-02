import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createMemo, createSignal, onMount } from "solid-js"
import { Keybind } from "@/util/keybind"
import { useTheme } from "../context/theme"
import { DialogMemoryAdd } from "./dialog-memory-add"
import path from "path"

interface Memory {
  id: string
  content: string
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

async function loadMemories(): Promise<Memory[]> {
  try {
    const file = Bun.file(MEMORY_FILE)
    if (await file.exists()) {
      const store = (await file.json()) as MemoryStore
      return store.memories
    }
  } catch (error) {
    console.error("Failed to load memories:", error)
  }
  return []
}

async function saveMemories(memories: Memory[]): Promise<void> {
  try {
    const dir = path.dirname(MEMORY_FILE)
    await Bun.$`mkdir -p ${dir}`.quiet()
    const store: MemoryStore = {
      memories,
      version: "1.0.0",
      lastUpdated: Date.now(),
    }
    await Bun.write(MEMORY_FILE, JSON.stringify(store, null, 2))
  } catch (error) {
    console.error("Failed to save memories:", error)
    throw error
  }
}

function formatTimeAgo(timestamp: number): string {
  const age = Math.floor((Date.now() - timestamp) / 1000)
  if (age < 60) return `${age}s ago`
  if (age < 3600) return `${Math.floor(age / 60)}m ago`
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`
  return `${Math.floor(age / 86400)}d ago`
}

export function DialogMemoryList() {
  const dialog = useDialog()
  const { theme } = useTheme()

  const [memories, setMemories] = createSignal<Memory[]>([])
  const [toDelete, setToDelete] = createSignal<string>()
  const [filter, setFilter] = createSignal<string>("all")

  onMount(async () => {
    dialog.setSize("large")
    const loaded = await loadMemories()
    setMemories(loaded)
  })

  const filteredMemories = createMemo(() => {
    const all = memories()
    const filterType = filter()
    if (filterType === "all") return all
    return all.filter((m) => m.metadata.type === filterType)
  })

  const options = createMemo(() => {
    return filteredMemories().map((memory) => {
      const isDeleting = toDelete() === memory.id
      const typeEmoji = {
        fact: "📚",
        preference: "⚙️",
        context: "📝",
        learning: "💡",
      }[memory.metadata.type]

      return {
        title: isDeleting
          ? "Press delete again to confirm"
          : `${typeEmoji} ${memory.content.substring(0, 80)}${memory.content.length > 80 ? "..." : ""}`,
        bg: isDeleting ? theme.error : undefined,
        value: memory.id,
        category: memory.metadata.type,
        footer: `${formatTimeAgo(memory.metadata.timestamp)} | Importance: ${memory.metadata.importance || 5}/10${
          memory.metadata.tags?.length ? ` | ${memory.metadata.tags.join(", ")}` : ""
        }`,
      }
    })
  })

  const deleteMemory = async (id: string) => {
    const updated = memories().filter((m) => m.id !== id)
    await saveMemories(updated)
    setMemories(updated)
    setToDelete(undefined)
  }

  return (
    <DialogSelect
      title={`Memories (${filteredMemories().length})`}
      options={options()}
      limit={50}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        const memory = memories().find((m) => m.id === option.value)
        if (memory) {
          // TODO: Show memory details dialog
          dialog.clear()
        }
      }}
      keybind={[
        {
          keybind: Keybind.parse("a")[0],
          title: "add",
          onTrigger: async () => {
            dialog.replace(() => (
              <DialogMemoryAdd
                onSave={(newMemory) => {
                  setMemories([...memories(), newMemory])
                }}
              />
            ))
          },
        },
        {
          keybind: Keybind.parse("f")[0],
          title: "filter",
          onTrigger: async () => {
            const types = ["all", "fact", "preference", "context", "learning"]
            const current = filter()
            const nextIndex = (types.indexOf(current) + 1) % types.length
            setFilter(types[nextIndex])
          },
        },
        {
          keybind: Keybind.parse("ctrl+d")[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              await deleteMemory(option.value)
              return
            }
            setToDelete(option.value)
          },
        },
      ]}
    />
  )
}
