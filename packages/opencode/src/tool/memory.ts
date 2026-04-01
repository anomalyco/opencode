import z from "zod"
import { Tool } from "./tool"
import { MemoryStore } from "../memory/store"
import { Memory } from "../memory/memory"
import { Instance } from "../project/instance"

export const MemoryTool = Tool.define("memory", {
  description:
    "Store and retrieve persistent memories across sessions. Use this to remember important decisions, architecture patterns, or learnings.",
  parameters: z.object({
    action: z.enum(["save", "search", "list", "delete"]).describe("The action to perform"),
    content: z.string().optional().describe("Content to save (required for save action)"),
    tags: z.array(z.string()).optional().describe("Tags for categorization (optional for save)"),
    query: z.string().optional().describe("Search query (required for search action)"),
    id: z.string().optional().describe("Memory ID to delete (required for delete action)"),
  }),
  async execute(params, ctx) {
    const projectID = Instance.project.id

    switch (params.action) {
      case "save": {
        if (!params.content) {
          throw new Error("content is required for save action")
        }
        const entry = Memory.create({
          content: params.content,
          tags: params.tags || [],
          projectID,
          source: { sessionID: ctx.sessionID },
        })
        await MemoryStore.save(entry)
        return {
          title: "Memory saved",
          output: `Memory saved with ID: ${entry.id}\nContent: ${entry.content}\nTags: ${entry.tags.join(", ")}`,
          metadata: { id: entry.id, count: 0 },
        }
      }

      case "search": {
        if (!params.query) {
          throw new Error("query is required for search action")
        }
        const memories = await MemoryStore.search(params.query, projectID)
        const output =
          memories.length === 0
            ? "No memories found matching your query."
            : `Found ${memories.length} memory/memories:\n\n` +
              memories
                .map(
                  (m, i) =>
                    `${i + 1}. [${m.id}] ${m.content}\n   Tags: ${m.tags.join(", ")}\n   Created: ${new Date(m.time.created).toISOString()}`,
                )
                .join("\n\n")
        return {
          title: "Search results",
          output,
          metadata: { id: "", count: memories.length },
        }
      }

      case "list": {
        const memories = await MemoryStore.list(projectID)
        const output =
          memories.length === 0
            ? "No memories found for this project."
            : `Found ${memories.length} memory/memories:\n\n` +
              memories
                .map(
                  (m, i) =>
                    `${i + 1}. [${m.id}] ${m.content}\n   Tags: ${m.tags.join(", ")}\n   Created: ${new Date(m.time.created).toISOString()}`,
                )
                .join("\n\n")
        return {
          title: "All memories",
          output,
          metadata: { id: "", count: memories.length },
        }
      }

      case "delete": {
        if (!params.id) {
          throw new Error("id is required for delete action")
        }
        await MemoryStore.remove(params.id, projectID)
        return {
          title: "Memory deleted",
          output: `Memory ${params.id} has been deleted.`,
          metadata: { id: params.id, count: 0 },
        }
      }

      default: {
        throw new Error(`Unknown action: ${(params as any).action}`)
      }
    }
  },
})
