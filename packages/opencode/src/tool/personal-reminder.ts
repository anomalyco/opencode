import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-reminder.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("list", "get", "create", "complete", "delete"),
  id: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  due_at: Schema.optional(Schema.Number),
  priority: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
})

function formatReminder(r: any) {
  const status = r.status === "completed" ? "[x]" : "[ ]"
  const due = r.due_at ? `Due: ${new Date(r.due_at).toISOString()}` : "No due date"
  return `${status} ${r.title} (${r.id}) — ${due}${r.priority ? ` [${r.priority}]` : ""}${r.category ? ` (${r.category})` : ""}${r.description ? `\n   ${r.description}` : ""}`
}

export const PersonalReminderTool = Tool.define(
  "personal_reminder",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { Reminder } = yield* Effect.promise(() => import("@opencode-ai/core/personal/reminder"))
          const svc = yield* Reminder

          switch (params.action) {
            case "list": {
              const reminders = yield* svc.list(undefined, params.category)
              const output = reminders.length === 0
                ? "No reminders found."
                : reminders.map((r: any) => formatReminder(r)).join("\n")
              return { title: `${reminders.length} lembrete(s)`, output }
            }
            case "get": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for get action"))
              const reminder = yield* svc.get(params.id)
              return { title: reminder.title, output: formatReminder(reminder) }
            }
            case "create": {
              if (!params.title) return yield* Effect.fail(new Error("title is required for create action"))
              const reminder = yield* svc.create(
                params.title,
                params.description,
                params.due_at,
                undefined,
                params.priority,
                params.category,
              )
              return { title: "Lembrete criado", output: formatReminder(reminder) }
            }
            case "complete": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for complete action"))
              yield* svc.complete(params.id)
              return { title: "Lembrete concluído", output: `Reminder ${params.id} completed.` }
            }
            case "delete": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for delete action"))
              yield* svc.delete(params.id)
              return { title: "Lembrete removido", output: `Reminder ${params.id} deleted.` }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
