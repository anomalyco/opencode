import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-workflow.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("create", "list", "execute", "delete"),
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  steps: Schema.optional(Schema.String),
  trigger: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
})

export const PersonalWorkflowTool = Tool.define(
  "personal_workflow",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { Workflow } = yield* Effect.promise(() => import("@opencode-ai/core/personal/workflow"))
          const svc = yield* Workflow

          switch (params.action) {
            case "create": {
              if (!params.name || !params.steps)
                return yield* Effect.fail(new Error("name and steps are required for create action"))
              const steps = Option.try(() => JSON.parse(params.steps) as any[]).pipe(Option.getOrElse(() => [{ action: params.steps, tool: "bash", params: {} }]))
              const workflow = yield* svc.create(params.name, params.description ?? "", steps, params.trigger ? JSON.parse(params.trigger) : undefined)
              return { title: "Workflow criado", output: JSON.stringify(workflow, null, 2) }
            }
            case "list": {
              const workflows = yield* svc.list()
              const output = workflows.length === 0
                ? "No workflows defined."
                : workflows.map((w: any) => `- ${w.name} (${w.id})${w.description ? `: ${w.description}` : ""}${w.trigger ? ` [trigger: ${w.trigger}]` : ""}`).join("\n")
              return { title: `${workflows.length} workflow(s)`, output }
            }
            case "execute": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for execute action"))
              const result = yield* svc.execute(params.id)
              return { title: "Workflow executado", output: JSON.stringify(result, null, 2) }
            }
            case "delete": {
              if (!params.id) return yield* Effect.fail(new Error("id is required for delete action"))
              yield* svc.delete(params.id)
              return { title: "Workflow removido", output: `Workflow ${params.id} deleted.` }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
