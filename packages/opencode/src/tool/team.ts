import { Tool } from "./tool"
import DESCRIPTION from "./team.txt"
import z from "zod"
import { Session } from "../session"
import { MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"

const task = z.object({
  id: z.string().describe("Unique identifier for this task"),
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  depends: z
    .array(z.string())
    .optional()
    .describe("Array of task IDs this task depends on"),
})

const parameters = z.object({
  tasks: z
    .array(task)
    .min(1, "Provide at least one task")
    .max(25, "Maximum of 25 tasks allowed"),
  concurrency: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum number of simultaneous sub-agents"),
})

type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped"

interface TaskState {
  status: TaskStatus
  result?: string
  error?: string
  sessionID?: string
}

function validateDependencies(tasks: z.infer<typeof parameters>["tasks"]): void {
  const ids = new Set(tasks.map((t) => t.id))
  const duplicates = tasks.length - ids.size
  if (duplicates > 0) throw new Error("Duplicate task IDs found")

  for (const t of tasks) {
    for (const dep of t.depends ?? []) {
      if (!ids.has(dep)) throw new Error(`Task "${t.id}" depends on unknown task "${dep}"`)
      if (dep === t.id) throw new Error(`Task "${t.id}" depends on itself`)
    }
  }

  // detect cycles via topological sort
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const depMap = new Map(tasks.map((t) => [t.id, t.depends ?? []]))

  function visit(id: string): void {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`Circular dependency detected involving task "${id}"`)
    visiting.add(id)
    for (const dep of depMap.get(id) ?? []) {
      visit(dep)
    }
    visiting.delete(id)
    visited.add(id)
  }

  for (const t of tasks) {
    visit(t.id)
  }
}

export const TeamTool = Tool.define("team", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      validateDependencies(params.tasks)

      const config = await Config.get()
      const states = new Map<string, TaskState>(
        params.tasks.map((t) => [t.id, { status: "pending" as const }]),
      )
      const resolvers = new Map<string, { resolve: () => void; promise: Promise<void> }>()
      for (const t of params.tasks) {
        const r = {} as { resolve: () => void; promise: Promise<void> }
        r.promise = new Promise<void>((resolve) => {
          r.resolve = resolve
        })
        resolvers.set(t.id, r)
      }

      const cancellers: Array<() => void> = []
      function cancelAll() {
        for (const fn of cancellers) fn()
      }
      ctx.abort.addEventListener("abort", cancelAll)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancelAll))

      const semaphore = params.concurrency
        ? createSemaphore(params.concurrency)
        : undefined

      async function runTask(t: z.infer<typeof task>): Promise<void> {
        // wait for dependencies
        for (const dep of t.depends ?? []) {
          await resolvers.get(dep)!.promise
          const depState = states.get(dep)!
          if (depState.status !== "completed") {
            states.set(t.id, { status: "skipped", error: `Dependency "${dep}" ${depState.status}` })
            resolvers.get(t.id)!.resolve()
            return
          }
        }

        if (ctx.abort.aborted) {
          states.set(t.id, { status: "skipped", error: "Aborted" })
          resolvers.get(t.id)!.resolve()
          return
        }

        const release = semaphore ? await semaphore.acquire() : undefined

        await ctx.ask({
          permission: "task",
          patterns: [t.subagent_type],
          always: ["*"],
          metadata: {
            description: t.description,
            subagent_type: t.subagent_type,
          },
        })

        const agent = await Agent.get(t.subagent_type)
        if (!agent) {
          states.set(t.id, { status: "failed", error: `Unknown agent type: ${t.subagent_type}` })
          resolvers.get(t.id)!.resolve()
          release?.()
          return
        }

        states.set(t.id, { status: "running" })

        const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")
        const hasTodoWritePermission = agent.permission.some((rule) => rule.permission === "todowrite")

        const session = await Session.create({
          parentID: ctx.sessionID,
          title: t.description + ` (@${agent.name} subagent)`,
          permission: [
            ...(hasTodoWritePermission
              ? []
              : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
            ...(hasTaskPermission
              ? []
              : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
            ...(config.experimental?.primary_tools?.map((tool) => ({
              pattern: "*",
              action: "allow" as const,
              permission: tool,
            })) ?? []),
          ],
        })

        states.set(t.id, { ...states.get(t.id)!, sessionID: session.id })

        function cancel() {
          SessionPrompt.cancel(session.id)
        }
        cancellers.push(cancel)

        const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
        if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

        const model = agent.model ?? {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        }

        // prepend dependency results to prompt
        const depResults = (t.depends ?? [])
          .map((dep) => {
            const state = states.get(dep)!
            return `<dependency id="${dep}" status="${state.status}">\n${state.result ?? ""}\n</dependency>`
          })
          .join("\n")
        const fullPrompt = depResults ? `${depResults}\n\n${t.prompt}` : t.prompt

        const messageID = MessageID.ascending()
        const promptParts = await SessionPrompt.resolvePromptParts(fullPrompt)

        const result = await SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            ...(hasTodoWritePermission ? {} : { todowrite: false }),
            ...(hasTaskPermission ? {} : { task: false }),
            ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((tool) => [tool, false])),
          },
          parts: promptParts,
        }).catch((error) => {
          states.set(t.id, { ...states.get(t.id)!, status: "failed", error: String(error) })
          resolvers.get(t.id)!.resolve()
          release?.()
          return undefined
        })

        if (!result) return

        const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
        states.set(t.id, { ...states.get(t.id)!, status: "completed", result: text })
        resolvers.get(t.id)!.resolve()
        release?.()
      }

      await Promise.all(params.tasks.map((t) => runTask(t)))

      const output = [
        "<team_results>",
        ...params.tasks.map((t) => {
          const state = states.get(t.id)!
          return [
            `<agent id="${t.id}" agent="${t.subagent_type}" status="${state.status}">`,
            ...(state.sessionID ? [`  task_id: ${state.sessionID}`] : []),
            ...(state.error ? [`  error: ${state.error}`] : []),
            ...(state.result ? [`  ${state.result}`] : []),
            `</agent>`,
          ].join("\n")
        }),
        "</team_results>",
      ].join("\n")

      const completed = params.tasks.filter((t) => states.get(t.id)!.status === "completed").length
      const failed = params.tasks.filter((t) => states.get(t.id)!.status === "failed").length
      const skipped = params.tasks.filter((t) => states.get(t.id)!.status === "skipped").length

      return {
        title: `Team execution (${completed}/${params.tasks.length} completed${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} skipped` : ""})`,
        metadata: {
          tasks: params.tasks.map((t) => ({
            id: t.id,
            status: states.get(t.id)!.status,
            sessionId: states.get(t.id)!.sessionID,
          })),
        },
        output,
      }
    },
  }
})

function createSemaphore(max: number) {
  const waiting: Array<() => void> = []
  const active = { count: 0 }

  function acquire(): Promise<() => void> {
    if (active.count < max) {
      active.count++
      return Promise.resolve(release)
    }
    return new Promise<() => void>((resolve) => {
      waiting.push(() => {
        active.count++
        resolve(release)
      })
    })
  }

  function release() {
    active.count--
    const next = waiting.shift()
    if (next) next()
  }

  return { acquire }
}
