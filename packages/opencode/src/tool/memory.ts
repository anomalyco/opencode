import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./memory.txt"
import { Memory } from "@opencode-ai/core/memory"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["teach", "recall", "learn", "list", "delete"]).annotate({
    description:
      "Action to perform: 'teach' (save new instruction/knowledge), 'recall' (retrieve matching memories), 'learn' (persist learned insights from session), 'list' (browse saved memories), or 'delete' (remove an obsolete memory).",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "Knowledge or teaching content to persist (required for 'teach' and 'learn' if custom content).",
  }),
  title: Schema.optional(Schema.String).annotate({
    description: "Brief descriptive title or headline for the memory.",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query or keywords to recall relevant memories (for 'recall').",
  }),
  category: Schema.optional(Schema.String).annotate({
    description:
      "Category tag: e.g. 'convention', 'architecture', 'preference', 'testing', 'debugging', 'learned', 'general'.",
  }),
  tags: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional list of keywords or tags for search and categorization.",
  }),
  id: Schema.optional(Schema.String).annotate({
    description: "Memory ID (required for 'delete').",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of memories to return (for 'recall' or 'list', default 10).",
  }),
})

type Metadata = {
  action: string
  count?: number
  id?: string
}

export const MemoryTool = Tool.define<typeof Parameters, Metadata, Memory.Service>(
  "memory",
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const projectID = instance.project.id

          if (params.action === "teach") {
            const content = params.content?.trim()
            if (!content) {
              return {
                title: "Memory teach failed",
                output: "Error: 'content' is required when saving teachings via the 'teach' action.",
                metadata: { action: "teach", count: 0 },
              }
            }

            const item = yield* memory.teach({
              title: params.title,
              content,
              category: params.category || "convention",
              tags: params.tags ? [...params.tags] : [],
              source: "teach",
              projectID,
              sessionID: ctx.sessionID,
            })

            return {
              title: `Saved memory: "${item.title}"`,
              output: [
                `Successfully saved teaching into long-term memory.`,
                `ID: ${item.id}`,
                `Title: ${item.title}`,
                `Category: ${item.category}`,
                `Tags: ${item.tags.join(", ") || "(none)"}`,
                `Content:`,
                item.content,
              ].join("\n"),
              metadata: { action: "teach", id: item.id, count: 1 },
            }
          }

          if (params.action === "recall") {
            const query = (params.query || params.content || "").trim()
            const items = yield* memory.recall({
              query,
              category: params.category,
              projectID,
              limit: params.limit ?? 10,
            })

            if (items.length === 0) {
              return {
                title: `No memories found for "${query}"`,
                output: `No matching memories found in persistent storage for query "${query}".`,
                metadata: { action: "recall", count: 0 },
              }
            }

            const formatted = items.map(
              (item, i) =>
                `### ${i + 1}. [${item.category.toUpperCase()}] ${item.title} (ID: ${item.id})\n` +
                `Tags: ${item.tags.join(", ") || "none"} | Created: ${new Date(item.time_created).toLocaleDateString()}\n\n` +
                `${item.content}\n`,
            )

            return {
              title: `Recalled ${items.length} memories for "${query}"`,
              output: [`Found ${items.length} relevant memories:`, "", ...formatted].join("\n"),
              metadata: { action: "recall", count: items.length },
            }
          }

          if (params.action === "learn") {
            // Learn explicit content or extract lessons from current session
            const content = params.content?.trim()
            if (content) {
              const item = yield* memory.teach({
                title: params.title,
                content,
                category: params.category || "learned",
                tags: params.tags ? [...params.tags] : ["learned"],
                source: "learn",
                projectID,
                sessionID: ctx.sessionID,
              })
              return {
                title: `Learned: "${item.title}"`,
                output: [
                  `Saved learned insight to persistent memory.`,
                  `ID: ${item.id}`,
                  `Title: ${item.title}`,
                  `Category: ${item.category}`,
                  `Content:`,
                  item.content,
                ].join("\n"),
                metadata: { action: "learn", id: item.id, count: 1 },
              }
            }

            // If no content given, extract from messages
            const userMessages = ctx.messages
              .filter((m) => m.info.role === "user")
              .flatMap((m) => m.parts)
              .filter((p) => p.type === "text")
              .map((p) => (p as any).text)
              .filter(Boolean)

            return {
              title: "Learn from session",
              output:
                "Please analyze the session messages and provide the specific lessons/teachings to store using the 'learn' action with 'content' and 'title'.",
              metadata: { action: "learn", count: 0 },
            }
          }

          if (params.action === "list") {
            const items = yield* memory.list({
              category: params.category,
              projectID,
              limit: params.limit ?? 25,
            })

            if (items.length === 0) {
              return {
                title: "Memory store is empty",
                output: "No saved memories found.",
                metadata: { action: "list", count: 0 },
              }
            }

            const formatted = items.map(
              (item, i) =>
                `${i + 1}. [${item.category}] **${item.title}** (ID: \`${item.id}\`)\n` +
                `   ${item.content.length > 120 ? item.content.slice(0, 117) + "..." : item.content}`,
            )

            return {
              title: `${items.length} saved memories`,
              output: [`Total memories: ${items.length}`, "", ...formatted].join("\n"),
              metadata: { action: "list", count: items.length },
            }
          }

          if (params.action === "delete") {
            if (!params.id) {
              return {
                title: "Delete failed",
                output: "Error: 'id' parameter is required for the 'delete' action.",
                metadata: { action: "delete", count: 0 },
              }
            }

            const removed = yield* memory.remove(params.id)
            return {
              title: removed ? `Deleted memory ${params.id}` : `Memory ${params.id} not found`,
              output: removed ? `Successfully deleted memory with ID: ${params.id}` : `No memory found with ID: ${params.id}`,
              metadata: { action: "delete", id: params.id, count: removed ? 1 : 0 },
            }
          }

          return {
            title: "Unknown action",
            output: `Unknown memory action: ${params.action}`,
            metadata: { action: params.action },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
