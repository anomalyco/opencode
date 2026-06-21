import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-calendar.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("list", "get", "create", "update", "delete"),
  id: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  start_at: Schema.optional(Schema.Number),
  end_at: Schema.optional(Schema.Number),
  location: Schema.optional(Schema.String),
  all_day: Schema.optional(Schema.Boolean),
})

function formatEvent(e: { id: string; title: string; description?: string; start_at: number; end_at: number; location?: string; all_day?: boolean }) {
  return [
    `## ${e.title} (${e.id})`,
    `When: ${new Date(e.start_at).toISOString()} → ${new Date(e.end_at).toISOString()}${e.all_day ? " (all day)" : ""}`,
    e.location ? `Where: ${e.location}` : null,
    e.description ? `\n${e.description}` : null,
  ].filter(Boolean).join("\n")
}

export const PersonalCalendarTool = Tool.define(
  "personal_calendar",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { Calendar } = yield* Effect.promise(() => import("@opencode-ai/core/personal/calendar"))
          const svc = yield* Calendar

          switch (params.action) {
            case "list": {
              const events = yield* svc.list(params.start_at, params.end_at)
              const output = events.length === 0
                ? "No events found."
                : events.map((e: any) => formatEvent(e)).join("\n\n")
              return { title: `${events.length} evento(s)`, output }
            }
            case "get": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for get action"))
              const event = yield* svc.get(params.id)
              return { title: event.title, output: formatEvent(event) }
            }
            case "create": {
              if (!params.title || !params.start_at)
                return yield* Effect.fail(new Error("title and start_at are required for create action"))
              const event = yield* svc.create(
                params.title,
                params.start_at,
                params.end_at,
                params.description,
                params.location,
                params.all_day ? 1 : 0,
              )
              return { title: "Evento criado", output: formatEvent(event) }
            }
            case "update": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for update action"))
              const event = yield* svc.update(params.id, {
                title: params.title,
                description: params.description,
                start_at: params.start_at,
                end_at: params.end_at,
                location: params.location,
                all_day: params.all_day !== undefined ? (params.all_day ? 1 : 0) : undefined,
              })
              return { title: "Evento atualizado", output: formatEvent(event) }
            }
            case "delete": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for delete action"))
              yield* svc.delete(params.id)
              return { title: "Evento removido", output: `Event ${params.id} deleted.` }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
