import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { MemoryStore } from "../../memory/store"
import { Memory } from "../../memory/memory"
import { Instance } from "../../project/instance"

interface MemoryListArgs {
  project?: string
}

interface MemorySearchArgs {
  query: string
  limit?: number
  project?: string
}

interface MemoryAddArgs {
  content: string
  tags?: string
  project?: string
}

interface MemoryDeleteArgs {
  id: string
  project?: string
}

export const MemoryCommand = cmd({
  command: "memory",
  describe: "manage project memories",
  builder: (yargs: Argv) => {
    return yargs
      .command(MemoryListSubCommand)
      .command(MemorySearchSubCommand)
      .command(MemoryAddSubCommand)
      .command(MemoryDeleteSubCommand)
      .demandCommand(1, "You must specify a subcommand: list, search, add, or delete")
  },
  handler: () => {
    // This won't be reached due to demandCommand
  },
})

export const MemoryListSubCommand = cmd({
  command: "list",
  describe: "list all memories for current project",
  builder: (yargs: Argv) => {
    return yargs.option("project", {
      describe: "filter by project (default: current project)",
      type: "string",
    })
  },
  handler: async (args: MemoryListArgs) => {
    await bootstrap(process.cwd(), async () => {
      const projectID = (args.project as string) || Instance.project.id
      const memories = await MemoryStore.list(projectID)
      displayList(memories)
    })
  },
})

export const MemorySearchSubCommand = cmd({
  command: "search <query>",
  describe: "search memories by query string",
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        describe: "search query string",
        type: "string",
      })
      .option("limit", {
        describe: "maximum number of results (default: 10)",
        type: "number",
        default: 10,
      })
      .option("project", {
        describe: "filter by project (default: current project)",
        type: "string",
      })
  },
  handler: async (args: any) => {
    await bootstrap(process.cwd(), async () => {
      const projectID = (args.project as string) || Instance.project.id
      const memories = await MemoryStore.search(args.query, projectID, args.limit)
      displayList(memories)
    })
  },
})

export const MemoryAddSubCommand = cmd({
  command: "add <content>",
  describe: "save a new memory",
  builder: (yargs: Argv) => {
    return yargs
      .positional("content", {
        describe: "memory content to save",
        type: "string",
      })
      .option("tags", {
        describe: "comma-separated list of tags",
        type: "string",
      })
      .option("project", {
        describe: "project to save to (default: current project)",
        type: "string",
      })
  },
  handler: async (args: any) => {
    await bootstrap(process.cwd(), async () => {
      const projectID = (args.project as string) || Instance.project.id
      const tags = args.tags ? (args.tags as string).split(",").map((t: string) => t.trim()) : []
      const entry = Memory.create({
        content: args.content,
        tags,
        projectID,
        source: { manual: true },
      })
      await MemoryStore.save(entry)
      console.log(`Memory saved with ID: ${entry.id}`)
    })
  },
})

export const MemoryDeleteSubCommand = cmd({
  command: "delete <id>",
  describe: "delete a memory by ID",
  builder: (yargs: Argv) => {
    return yargs.positional("id", {
      describe: "memory ID to delete",
      type: "string",
    })
  },
  handler: async (args: any) => {
    await bootstrap(process.cwd(), async () => {
      const projectID = (args.project as string) || Instance.project.id
      await MemoryStore.remove(args.id, projectID)
      console.log(`Memory ${args.id} deleted`)
    })
  },
})

function displayList(memories: Memory.Entry[]) {
  if (memories.length === 0) {
    console.log("No memories found.")
    return
  }

  const width = 72

  function renderRow(label: string, value: string): string {
    const availableWidth = width - 1
    const paddingNeeded = availableWidth - label.length - value.length
    const padding = Math.max(0, paddingNeeded)
    return `│${label}${" ".repeat(padding)}${value} │`
  }

  console.log("┌────────────────────────────────────────────────────────────────────┐")
  console.log("│                            MEMORIES                                │")
  console.log("├────────────────────────────────────────────────────────────────────┤")

  for (const memory of memories) {
    const dateCreated = new Date(memory.time.created).toISOString().split("T")[0]
    const tags = memory.tags.length > 0 ? `[${memory.tags.join(", ")}]` : ""
    const truncatedContent = memory.content.length > 40 ? memory.content.substring(0, 37) + "..." : memory.content

    console.log(`│ ${memory.id.padEnd(12)} │ ${truncatedContent.padEnd(42)} │`)
    console.log(renderRow("  Created", dateCreated))
    console.log(renderRow("  Tags", tags))
    console.log(renderRow("  Accesses", memory.accessCount.toString()))
    console.log("├────────────────────────────────────────────────────────────────────┤")
  }

  // Remove last separator and add bottom border
  process.stdout.write("\x1B[1A") // Move up one line
  console.log("└────────────────────────────────────────────────────────────────────┘")
  console.log()
  console.log(`Total: ${memories.length} memory/memories`)
}
