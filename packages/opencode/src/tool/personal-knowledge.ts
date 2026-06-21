import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-knowledge.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("index", "search", "list", "delete", "get"),
  title: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  query: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  id: Schema.optional(Schema.String),
})

export const PersonalKnowledgeTool = Tool.define(
  "personal_knowledge",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { Knowledge } = yield* Effect.promise(() => import("@opencode-ai/core/personal/knowledge"))
          const svc = yield* Knowledge

          switch (params.action) {
            case "index": {
              if (!params.title || !params.content)
                return yield* Effect.fail(new Error("title and content are required for index action"))
              const entry = yield* svc.index(params.title, params.content, params.source, params.tags)
              return { title: "Conhecimento indexado", output: JSON.stringify(entry, null, 2) }
            }
            case "search": {
              if (!params.query) return yield* Effect.fail(new Error("query is required for search action"))
              const results = yield* svc.search(params.query, params.limit ?? 5)
              const output = results.length === 0
                ? "No results found."
                : results.map((r: any, i: number) => `${i + 1}. ${r.title}${r.tags?.length ? ` [${r.tags.join(", ")}]` : ""}\n   ${r.content.slice(0, 200)}${r.content.length > 200 ? "..." : ""}`).join("\n\n")
              return { title: `${results.length} resultado(s)`, output }
            }
            case "list": {
              const entries = yield* svc.list(params.tags?.[0])
              const output = entries.length === 0
                ? "No entries in knowledge base."
                : entries.map((e: any) => `- ${e.title} (${e.id})${e.tags?.length ? ` [${e.tags.join(", ")}]` : ""}`).join("\n")
              return { title: `${entries.length} entrada(s)`, output }
            }
            case "get": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for get action"))
              const entry = yield* svc.get(params.id)
              return {
                title: entry.title,
                output: `# ${entry.title}\n\n${entry.content}\n\nSource: ${entry.source ?? "N/A"}\nTags: ${entry.tags?.join(", ") ?? "None"}`,
              }
            }
            case "delete": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for delete action"))
              yield* svc.delete(params.id)
              return { title: "Entrada removida", output: `Knowledge entry ${params.id} deleted.` }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
