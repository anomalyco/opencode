import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import path from "path"

interface Memory {
  id: string
  content: string
  embedding: number[]
  metadata: {
    type: "fact" | "preference" | "context" | "learning"
    timestamp: number
    sessionId?: string
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

async function loadMemory(): Promise<MemoryStore> {
  const file = Bun.file(MEMORY_FILE)
  if (await file.exists()) {
    return (await file.json()) as MemoryStore
  }
  return {
    memories: [],
    version: "1.0.0",
    lastUpdated: Date.now(),
  }
}

async function saveMemory(store: MemoryStore) {
  const dir = path.dirname(MEMORY_FILE)
  await Bun.$`mkdir -p ${dir}`.quiet()
  store.lastUpdated = Date.now()
  await Bun.write(MEMORY_FILE, JSON.stringify(store, null, 2))
}

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage persistent memories",
  builder: (yargs) =>
    yargs
      .command(MemoryListCommand)
      .command(MemorySearchCommand)
      .command(MemoryAddCommand)
      .command(MemoryDeleteCommand)
      .command(MemoryStatsCommand)
      .demandCommand(),
  async handler() {},
})

export const MemoryListCommand = cmd({
  command: "list",
  describe: "list all stored memories",
  builder: (yargs) =>
    yargs
      .option("type", {
        describe: "filter by memory type",
        type: "string",
        choices: ["fact", "preference", "context", "learning"],
      })
      .option("limit", {
        describe: "maximum number to return",
        type: "number",
        default: 20,
      })
      .option("sort", {
        describe: "sort order",
        type: "string",
        choices: ["recent", "importance", "type"],
        default: "recent",
      }),
  async handler(args) {
    try {
      const store = await loadMemory()

      if (store.memories.length === 0) {
        UI.println("📭 No memories stored yet.")
        UI.println("Use 'opencode memory add' to save information.")
        return
      }

      let memories = [...store.memories]

      // Filter by type
      if (args.type) {
        memories = memories.filter((m) => m.metadata.type === args.type)
      }

      // Sort
      memories.sort((a, b) => {
        switch (args.sort) {
          case "importance":
            return (b.metadata.importance || 5) - (a.metadata.importance || 5)
          case "type":
            return a.metadata.type.localeCompare(b.metadata.type)
          case "recent":
          default:
            return b.metadata.timestamp - a.metadata.timestamp
        }
      })

      // Limit
      memories = memories.slice(0, args.limit)

      UI.println(`🧠 Memory Store (${store.memories.length} total memories)`)
      UI.println(
        `Showing ${memories.length} memories${args.type ? ` (filtered by: ${args.type})` : ""}`,
      )
      UI.println(`Sorted by: ${args.sort}`)
      UI.empty()

      for (const memory of memories) {
        const age = Math.floor((Date.now() - memory.metadata.timestamp) / 1000)
        const ageStr =
          age < 60
            ? `${age}s ago`
            : age < 3600
              ? `${Math.floor(age / 60)}m ago`
              : age < 86400
                ? `${Math.floor(age / 3600)}h ago`
                : `${Math.floor(age / 86400)}d ago`

        UI.println(
          `📌 [${memory.metadata.type}] ${ageStr} | Importance: ${memory.metadata.importance}/10`,
        )
        UI.println(
          `   ${memory.content.substring(0, 200)}${memory.content.length > 200 ? "..." : ""}`,
        )
        UI.println(`   ID: ${memory.id}`)
        if (memory.metadata.tags && memory.metadata.tags.length > 0) {
          UI.println(`   Tags: ${memory.metadata.tags.join(", ")}`)
        }
        UI.empty()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to list memories: ${message}`)
      process.exit(1)
    }
  },
})

export const MemorySearchCommand = cmd({
  command: "search <query>",
  describe: "search memories (keyword search)",
  builder: (yargs) =>
    yargs
      .positional("query", {
        describe: "search query",
        type: "string",
        demandOption: true,
      })
      .option("type", {
        describe: "filter by memory type",
        type: "string",
        choices: ["fact", "preference", "context", "learning"],
      })
      .option("limit", {
        describe: "maximum number to return",
        type: "number",
        default: 10,
      }),
  async handler(args) {
    try {
      const store = await loadMemory()

      if (store.memories.length === 0) {
        UI.println("📭 No memories stored yet.")
        return
      }

      let memories = [...store.memories]

      // Filter by type
      if (args.type) {
        memories = memories.filter((m) => m.metadata.type === args.type)
      }

      // Simple keyword search
      const query = (args.query || "").toLowerCase()
      const results = memories
        .filter((m) => m.content.toLowerCase().includes(query))
        .slice(0, args.limit)

      if (results.length === 0) {
        UI.println(`🔍 No memories found for: "${args.query}"`)
        UI.empty()
        UI.println("Try:")
        UI.println("- Using different keywords")
        UI.println("- Checking stored memories with 'opencode memory list'")
        return
      }

      UI.println(`🧠 Found ${results.length} memories for: "${args.query}"`)
      UI.empty()

      for (const memory of results) {
        const age = Math.floor((Date.now() - memory.metadata.timestamp) / 1000)
        const ageStr =
          age < 60
            ? `${age}s ago`
            : age < 3600
              ? `${Math.floor(age / 60)}m ago`
              : age < 86400
                ? `${Math.floor(age / 3600)}h ago`
                : `${Math.floor(age / 86400)}d ago`

        UI.println(`📌 [${memory.metadata.type}] Importance: ${memory.metadata.importance}/10`)
        UI.println(`   ${memory.content}`)
        UI.println(`   ${ageStr} | ID: ${memory.id}`)
        if (memory.metadata.tags && memory.metadata.tags.length > 0) {
          UI.println(`   Tags: ${memory.metadata.tags.join(", ")}`)
        }
        UI.empty()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to search memories: ${message}`)
      process.exit(1)
    }
  },
})

export const MemoryAddCommand = cmd({
  command: "add",
  describe: "add a new memory interactively",
  async handler() {
    try {
      UI.empty()
      prompts.intro("Add Memory")

      const content = await prompts.text({
        message: "What would you like to remember?",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(content)) throw new UI.CancelledError()

      const type = await prompts.select({
        message: "Memory type",
        options: [
          { label: "Fact", value: "fact", hint: "General knowledge" },
          { label: "Preference", value: "preference", hint: "User preferences" },
          { label: "Context", value: "context", hint: "Contextual information" },
          { label: "Learning", value: "learning", hint: "Things learned" },
        ],
        initialValue: "fact",
      })
      if (prompts.isCancel(type)) throw new UI.CancelledError()

      const importance = await prompts.text({
        message: "Importance (1-10)",
        initialValue: "5",
        validate: (x) => {
          const num = parseInt(x || "")
          if (isNaN(num) || num < 1 || num > 10) return "Must be between 1 and 10"
          return undefined
        },
      })
      if (prompts.isCancel(importance)) throw new UI.CancelledError()

      const tagsInput = await prompts.text({
        message: "Tags (comma-separated, optional)",
        placeholder: "e.g., project, important",
      })
      if (prompts.isCancel(tagsInput)) throw new UI.CancelledError()

      const tags =
        typeof tagsInput === "string" && tagsInput.length > 0
          ? tagsInput.split(",").map((t) => t.trim())
          : undefined

      const store = await loadMemory()

      const memory: Memory = {
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        content: content as string,
        embedding: [], // No embedding for CLI version
        metadata: {
          type: type as "fact" | "preference" | "context" | "learning",
          timestamp: Date.now(),
          tags,
          importance: parseInt(importance as string),
        },
      }

      store.memories.push(memory)
      await saveMemory(store)

      prompts.outro(`✅ Memory stored successfully (ID: ${memory.id})`)
    } catch (error) {
      if (error instanceof UI.CancelledError) {
        prompts.cancel("Operation cancelled")
        process.exit(0)
      }
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to add memory: ${message}`)
      process.exit(1)
    }
  },
})

export const MemoryDeleteCommand = cmd({
  command: "delete <id>",
  describe: "delete a memory by ID",
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "memory ID to delete (or 'all' to clear everything)",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    try {
      const store = await loadMemory()

      if (args.id === "all") {
        const confirm = await prompts.confirm({
          message: `Delete all ${store.memories.length} memories?`,
          initialValue: false,
        })
        if (prompts.isCancel(confirm) || !confirm) {
          UI.println("Cancelled")
          return
        }

        const count = store.memories.length
        store.memories = []
        await saveMemory(store)
        UI.println(`🗑️  Deleted all ${count} memories`)
        return
      }

      const index = store.memories.findIndex((m) => m.id === args.id)
      if (index === -1) {
        UI.error(`❌ Memory not found: ${args.id}`)
        UI.println("Use 'opencode memory list' to see all memory IDs")
        process.exit(1)
      }

      const deleted = store.memories.splice(index, 1)[0]
      await saveMemory(store)

      UI.println(`🗑️  Deleted memory`)
      UI.empty()
      UI.println(`ID: ${deleted.id}`)
      UI.println(`Type: ${deleted.metadata.type}`)
      UI.println(`Content: ${deleted.content}`)
      UI.empty()
      UI.println(`Remaining memories: ${store.memories.length}`)
    } catch (error) {
      if (error instanceof UI.CancelledError) {
        UI.println("Cancelled")
        process.exit(0)
      }
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to delete memory: ${message}`)
      process.exit(1)
    }
  },
})

export const MemoryStatsCommand = cmd({
  command: "stats",
  describe: "show memory statistics",
  async handler() {
    try {
      const store = await loadMemory()

      if (store.memories.length === 0) {
        UI.println("📊 Memory Statistics")
        UI.empty()
        UI.println("Total memories: 0")
        UI.println("Status: Empty memory store")
        UI.empty()
        UI.println("Use 'opencode memory add' to start saving information!")
        return
      }

      const byType = {
        fact: 0,
        preference: 0,
        context: 0,
        learning: 0,
      }

      let totalImportance = 0
      let oldestTimestamp = Infinity
      let newestTimestamp = 0
      const tags = new Set<string>()

      for (const memory of store.memories) {
        byType[memory.metadata.type]++
        totalImportance += memory.metadata.importance || 5
        if (memory.metadata.timestamp < oldestTimestamp) {
          oldestTimestamp = memory.metadata.timestamp
        }
        if (memory.metadata.timestamp > newestTimestamp) {
          newestTimestamp = memory.metadata.timestamp
        }
        memory.metadata.tags?.forEach((tag) => tags.add(tag))
      }

      const avgImportance = totalImportance / store.memories.length
      const oldestAge = Math.floor((Date.now() - oldestTimestamp) / 1000 / 86400)
      const newestAge = Math.floor((Date.now() - newestTimestamp) / 1000)

      const fileSize = (await Bun.file(MEMORY_FILE).exists()) ? Bun.file(MEMORY_FILE).size : 0

      UI.println("📊 Memory Statistics")
      UI.empty()
      UI.println(`Total Memories: ${store.memories.length}`)
      UI.println(`Memory Size: ${(fileSize / 1024).toFixed(2)} KB`)
      UI.println(`Last Updated: ${new Date(store.lastUpdated).toLocaleString()}`)
      UI.empty()

      UI.println("By Type:")
      UI.println(
        `  Facts:       ${byType.fact.toString().padStart(3)} (${((byType.fact / store.memories.length) * 100).toFixed(0)}%)`,
      )
      UI.println(
        `  Preferences: ${byType.preference.toString().padStart(3)} (${((byType.preference / store.memories.length) * 100).toFixed(0)}%)`,
      )
      UI.println(
        `  Context:     ${byType.context.toString().padStart(3)} (${((byType.context / store.memories.length) * 100).toFixed(0)}%)`,
      )
      UI.println(
        `  Learning:    ${byType.learning.toString().padStart(3)} (${((byType.learning / store.memories.length) * 100).toFixed(0)}%)`,
      )
      UI.empty()

      UI.println(`Average Importance: ${avgImportance.toFixed(1)}/10`)
      UI.println(`Oldest Memory: ${oldestAge}d ago`)
      UI.println(
        `Newest Memory: ${newestAge < 60 ? newestAge + "s" : Math.floor(newestAge / 60) + "m"} ago`,
      )
      UI.println(`Unique Tags: ${tags.size}`)

      if (tags.size > 0) {
        UI.empty()
        UI.println(`Top Tags: ${Array.from(tags).slice(0, 10).join(", ")}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(`Failed to get stats: ${message}`)
      process.exit(1)
    }
  },
})
