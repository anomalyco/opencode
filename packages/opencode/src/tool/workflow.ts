import { Workflow } from "@/workflow"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Config } from "@/config/config"
import * as Tool from "./tool"
import DESCRIPTION from "./workflow.txt"
import type { TaskPromptOps } from "./task"
import { Effect, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"

const log = Log.create({ service: "tool.workflow" })

const Parameters = Schema.Struct({
  script: Schema.String.annotate({
    description:
      "JavaScript workflow script. Use agent(), parallel(), sleep() to orchestrate subagents. Return a string as the final result.",
  }),
  save: Schema.optional(Schema.String).annotate({
    description:
      "Save this workflow with the given name for reuse as a slash command. Saved to .opencode/workflows/<name>.js",
  }),
  args: Schema.optional(Schema.String).annotate({
    description: "Arguments to pass to the workflow (available as `args` global in script)",
  }),
})

export const WorkflowTool = Tool.define(
  "workflow",
  Effect.gen(function* () {
    const workflow = yield* Workflow.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const agent = yield* Agent.Service

    const run = Effect.fn("WorkflowTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      if (cfg.workflow?.disable) {
        return yield* Effect.fail(new Error("Workflows are disabled in config"))
      }

      yield* ctx.ask({
        permission: "workflow",
        patterns: ["*"],
        always: ["*"],
        metadata: {
          scriptLength: params.script.length,
          save: params.save,
        },
      })

      // Validate save name to prevent path traversal
      if (params.save) {
        if (!/^[a-zA-Z0-9_-]+$/.test(params.save)) {
          return yield* Effect.fail(new Error(`Invalid workflow name: "${params.save}". Only letters, numbers, hyphens, and underscores are allowed.`))
        }
      }

      const parent = yield* sessions.get(ctx.sessionID)
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined

      const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
      if (!ops) {
        return yield* Effect.fail(new Error("WorkflowTool requires promptOps in ctx.extra"))
      }

      if (params.save) {
        const dirs = yield* config.directories()
        const projectDir = dirs[0]
        if (projectDir) {
          const workflowPath = path.join(projectDir, ".opencode", "workflows", `${params.save}.js`)
          yield* Effect.promise(async () => {
            const { mkdir, writeFile } = await import("node:fs/promises")
            await mkdir(path.dirname(workflowPath), { recursive: true })
            await writeFile(workflowPath, params.script, "utf-8")
          })
          log.info("saved workflow", { name: params.save, path: workflowPath })
        }
      }

      const result = yield* workflow.execute({
        script: params.script,
        args: params.args,
        parentSessionID: ctx.sessionID,
        parentAgent,
        ops,
        ctx: {
          abort: ctx.abort,
          ask: ctx.ask,
          metadata: ctx.metadata,
          extra: ctx.extra,
        },
      })

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(Effect.orDie)
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("WorkflowTool requires an assistant message"))

      const metadata = {
        scriptLength: params.script.length,
        saved: params.save !== undefined,
        model: {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        },
      }

      return {
        title: params.save ? `workflow: ${params.save}` : "workflow execution",
        metadata,
        output: result,
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) => run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
