import z from "zod"
import { Tool } from "./tool"
import { TaskTool } from "./task"
import DESCRIPTION from "./team.txt"

const task = z.object({
  id: z.string().optional(),
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the sub-agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z.string().describe("Resume an existing sub-agent session if provided").optional(),
})

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the team execution"),
  tasks: z.array(task).min(1).max(10).describe("Sub-agent tasks to execute"),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe("Maximum number of child tasks to run concurrently (default: 4)"),
})

function parse(input: string) {
  const key = "task_id:"
  const idx = input.indexOf(key)
  if (idx < 0) return
  const line = input
    .slice(idx + key.length)
    .split("\n")[0]
    ?.trim()
  if (!line) return
  const first = line.split(" ")[0]
  return first || undefined
}

function getErr(err: unknown) {
  if (err instanceof Error) return err.message
  return String(err)
}

export const TeamTool = Tool.define("team", async (ctx) => {
  const subtask = await TaskTool.init(ctx)

  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const started = Date.now()
      const jobs = params.tasks
      const limit = params.concurrency ?? 4
      const asks = Array.from(new Set(jobs.map((item) => item.subagent_type)))
      const denied = new Map<string, string>()

      for (const subagent_type of asks) {
        try {
          await ctx.ask({
            permission: "task",
            patterns: [subagent_type],
            always: [subagent_type],
            metadata: {
              description: params.description,
              subagent_type,
              team: true,
            },
          })
        } catch (err) {
          denied.set(subagent_type, getErr(err))
        }
      }

      const out = await Promise.all(
        jobs.map(async (item, i) => ({
          i,
          item,
          run: async () => {
            const start = Date.now()
            try {
              if (denied.has(item.subagent_type)) {
                return {
                  id: item.id ?? `task_${i + 1}`,
                  description: item.description,
                  subagent_type: item.subagent_type,
                  status: "error" as const,
                  error: denied.get(item.subagent_type),
                  task_id: item.task_id,
                  duration_ms: Date.now() - start,
                }
              }

              const result = await subtask.execute(
                {
                  description: item.description,
                  prompt: item.prompt,
                  subagent_type: item.subagent_type,
                  task_id: item.task_id,
                },
                {
                  ...ctx,
                  extra: {
                    ...ctx.extra,
                    bypassAgentCheck: true,
                  },
                },
              )

              return {
                id: item.id ?? `task_${i + 1}`,
                description: item.description,
                subagent_type: item.subagent_type,
                status: "completed" as const,
                output: result.output,
                task_id:
                  (typeof result.metadata?.sessionId === "string" && result.metadata.sessionId) ||
                  parse(result.output) ||
                  item.task_id,
                duration_ms: Date.now() - start,
              }
            } catch (err) {
              return {
                id: item.id ?? `task_${i + 1}`,
                description: item.description,
                subagent_type: item.subagent_type,
                status: "error" as const,
                error: getErr(err),
                task_id: item.task_id,
                duration_ms: Date.now() - start,
              }
            }
          },
        })),
      )

      const result = new Array<Awaited<ReturnType<(typeof out)[number]["run"]>>>(out.length)
      let next = 0
      const workers = Array.from({ length: Math.min(limit, out.length) }, async () => {
        while (true) {
          const idx = next
          next += 1
          const item = out[idx]
          if (!item) return
          if (ctx.abort.aborted) return
          result[idx] = await item.run()
        }
      })
      await Promise.all(workers)

      const list = result.filter((item) => item !== undefined)

      const good = list.filter((item) => item.status === "completed")
      const bad = list.filter((item) => item.status === "error")

      const body = [
        `Team summary: ${good.length}/${list.length} tasks completed`,
        ...list.map((item) =>
          item.status === "completed"
            ? [
                ``,
                `## ${item.id} (${item.subagent_type})`,
                `status: completed`,
                `task_id: ${item.task_id ?? "unknown"}`,
                `${item.output}`,
              ].join("\n")
            : [
                ``,
                `## ${item.id} (${item.subagent_type})`,
                `status: error`,
                `task_id: ${item.task_id ?? "unknown"}`,
                `error: ${item.error}`,
              ].join("\n"),
        ),
      ].join("\n")

      return {
        title: params.description,
        output: body,
        metadata: {
          total: result.length,
          successful: good.length,
          failed: bad.length,
          duration_ms: Date.now() - started,
          children: list,
        },
      }
    },
  }
})
