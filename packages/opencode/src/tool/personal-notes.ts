import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-notes.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("list", "get", "create", "update", "delete", "search"),
  id: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  folder: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
})

function formatNote(note: { id: string; title: string; content: string; tags?: string[]; folder?: string | null; time_created: number; time_updated: number }) {
  return [
    `## ${note.title}`,
    `ID: ${note.id}`,
    `Folder: ${note.folder ?? "None"}`,
    `Tags: ${note.tags?.join(", ") ?? "None"}`,
    `Created: ${new Date(note.time_created).toISOString()}`,
    `Updated: ${new Date(note.time_updated).toISOString()}`,
    ``,
    note.content,
  ].join("\n")
}

export const PersonalNotesTool = Tool.define(
  "personal_notes",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { Notes } = yield* Effect.promise(() => import("@opencode-ai/core/personal/notes"))
          const svc = yield* Notes

          switch (params.action) {
            case "list": {
              const notes = yield* svc.list(params.folder)
              const output = notes.length === 0
                ? "No notes found."
                : notes.map((n: any) => `- ${n.title} (${n.id})${n.tags?.length ? ` [${n.tags.join(", ")}]` : ""}`).join("\n")
              return { title: `${notes.length} nota(s)`, output }
            }
            case "get": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for get action"))
              const note = yield* svc.get(params.id)
              return { title: note.title, output: formatNote(note) }
            }
            case "create": {
              if (!params.title) return yield* Effect.fail(new Error("title is required for create action"))
              const note = yield* svc.create(params.title, params.content ?? "", params.tags, params.folder)
              return { title: "Nota criada", output: formatNote(note) }
            }
            case "update": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for update action"))
              const note = yield* svc.update(params.id, {
                title: params.title,
                content: params.content,
                tags: params.tags,
                folder: params.folder,
              })
              return { title: "Nota atualizada", output: formatNote(note) }
            }
            case "delete": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for delete action"))
              yield* svc.delete(params.id)
              return { title: "Nota removida", output: `Note ${params.id} deleted.` }
            }
            case "search": {
              if (!params.query) return yield* Effect.fail(new Error("query is required for search action"))
              const notes = yield* svc.search(params.query)
              const output = notes.length === 0
                ? "No notes found matching query."
                : notes.map((n: any) => `- ${n.title} (${n.id})`).join("\n")
              return { title: `${notes.length} resultado(s)`, output }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
