import type { Argv } from "yargs"
import { effectCmd } from "../effect-cmd"
import { Memory } from "@opencode-ai/core/memory"
import { Effect } from "effect"

export const TeachCommand = effectCmd({
  command: "teach <context>",
  describe: "add new teachings into long term persistence memory",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("context", {
        type: "string",
        describe: "the instruction, convention, or knowledge to persist",
        demandOption: true,
      })
      .option("title", {
        type: "string",
        describe: "brief title for this teaching",
      })
      .option("category", {
        type: "string",
        default: "convention",
        describe: "category (e.g. convention, architecture, preference, testing)",
      })
      .option("tags", {
        type: "string",
        describe: "comma-separated tags or keywords",
      }),
  handler: Effect.fn("Cli.memory.teach")(function* (args: {
    context: string
    title?: string
    category?: string
    tags?: string
  }) {
    const memory = yield* Memory.Service
    const tagList = args.tags ? args.tags.split(",").map((t) => t.trim()).filter(Boolean) : []
    const item = yield* memory.teach({
      content: args.context,
      title: args.title,
      category: args.category || "convention",
      tags: tagList,
      source: "teach",
    })

    console.log(`Saved memory: "${item.title}"`)
    console.log(`  ID:       ${item.id}`)
    console.log(`  Category: ${item.category}`)
    if (item.tags.length > 0) {
      console.log(`  Tags:     ${item.tags.join(", ")}`)
    }
    console.log(`  Content:  ${item.content}`)
  }),
})

export const RecallCommand = effectCmd({
  command: "recall <query>",
  describe: "retrieve teaching knowledge from long term memory",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("query", {
        type: "string",
        describe: "search terms to recall relevant memories",
        demandOption: true,
      })
      .option("category", {
        type: "string",
        describe: "filter by category",
      })
      .option("limit", {
        type: "number",
        default: 10,
        describe: "maximum number of memories to return",
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"],
        default: "text",
        describe: "output format",
      }),
  handler: Effect.fn("Cli.memory.recall")(function* (args: {
    query: string
    category?: string
    limit?: number
    format?: string
  }) {
    const memory = yield* Memory.Service
    const items = yield* memory.recall({
      query: args.query,
      category: args.category,
      limit: args.limit ?? 10,
    })

    if (args.format === "json") {
      console.log(JSON.stringify(items, null, 2))
      return
    }

    if (items.length === 0) {
      console.log(`No memories found matching "${args.query}".`)
      return
    }

    console.log(`Found ${items.length} memories for "${args.query}":\n`)
    for (const [i, item] of items.entries()) {
      console.log(`${i + 1}. [${item.category}] ${item.title} (ID: ${item.id})`)
      if (item.tags.length > 0) {
        console.log(`   Tags: ${item.tags.join(", ")}`)
      }
      console.log(`   ${item.content}\n`)
    }
  }),
})

export const LearnCommand = effectCmd({
  command: "learn [content]",
  describe: "learn and persist valuable insights worthy of remembering long-term",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .positional("content", {
        type: "string",
        describe: "lesson or insight to persist",
      })
      .option("title", {
        type: "string",
        describe: "title for this learned insight",
      })
      .option("category", {
        type: "string",
        default: "learned",
        describe: "category for the memory",
      })
      .option("tags", {
        type: "string",
        describe: "comma-separated tags",
      }),
  handler: Effect.fn("Cli.memory.learn")(function* (args: {
    content?: string
    title?: string
    category?: string
    tags?: string
  }) {
    const memory = yield* Memory.Service
    if (!args.content) {
      console.log("Tip: Run `/learn` inside a TUI session to extract learnings from recent conversation history,")
      console.log('or pass an insight directly: `opencode memory learn "lesson content here"`')
      return
    }

    const tagList = args.tags ? args.tags.split(",").map((t) => t.trim()).filter(Boolean) : ["learned"]
    const item = yield* memory.teach({
      content: args.content,
      title: args.title,
      category: args.category || "learned",
      tags: tagList,
      source: "learn",
    })

    console.log(`Learned and saved: "${item.title}"`)
    console.log(`  ID:       ${item.id}`)
    console.log(`  Category: ${item.category}`)
    console.log(`  Content:  ${item.content}`)
  }),
})

const ListCommand = effectCmd({
  command: "list",
  describe: "list saved memories",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .option("category", {
        type: "string",
        describe: "filter by category",
      })
      .option("limit", {
        type: "number",
        default: 25,
        describe: "maximum number of memories to return",
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"],
        default: "text",
        describe: "output format",
      }),
  handler: Effect.fn("Cli.memory.list")(function* (args: {
    category?: string
    limit?: number
    format?: string
  }) {
    const memory = yield* Memory.Service
    const items = yield* memory.list({
      category: args.category,
      limit: args.limit ?? 25,
    })

    if (args.format === "json") {
      console.log(JSON.stringify(items, null, 2))
      return
    }

    if (items.length === 0) {
      console.log("No saved memories found.")
      return
    }

    console.log(`Saved memories (${items.length}):\n`)
    for (const [i, item] of items.entries()) {
      const preview = item.content.length > 80 ? item.content.slice(0, 77) + "..." : item.content
      console.log(`${i + 1}. [${item.category}] ${item.title}`)
      console.log(`   ID: ${item.id} | Created: ${new Date(item.time_created).toLocaleDateString()}`)
      console.log(`   ${preview}\n`)
    }
  }),
})

const DeleteCommand = effectCmd({
  command: "delete <id>",
  aliases: ["rm", "remove"],
  describe: "delete a memory by ID",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "memory ID to delete",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.memory.delete")(function* (args: { id: string }) {
    const memory = yield* Memory.Service
    const removed = yield* memory.remove(args.id)
    if (removed) {
      console.log(`Deleted memory: ${args.id}`)
    } else {
      console.log(`Memory not found: ${args.id}`)
    }
  }),
})

export const MemoryCommand = effectCmd({
  command: "memory [command]",
  describe: "long term persistence memory (/teach, /recall, /learn, /memory)",
  instance: false,
  builder: (yargs: Argv) =>
    yargs
      .command(TeachCommand)
      .command(RecallCommand)
      .command(LearnCommand)
      .command(ListCommand)
      .command(DeleteCommand),
  handler: Effect.fn("Cli.memory")(function* (args: any) {
    // If no subcommand is specified, show the list by default
    const memory = yield* Memory.Service
    const items = yield* memory.list({ limit: 25 })
    if (items.length === 0) {
      console.log("No saved memories found. Use `opencode memory teach <context>` to add one.")
      return
    }
    console.log(`Saved memories (${items.length}):\n`)
    for (const [i, item] of items.entries()) {
      const preview = item.content.length > 80 ? item.content.slice(0, 77) + "..." : item.content
      console.log(`${i + 1}. [${item.category}] ${item.title}`)
      console.log(`   ID: ${item.id} | Created: ${new Date(item.time_created).toLocaleDateString()}`)
      console.log(`   ${preview}\n`)
    }
  }),
})
