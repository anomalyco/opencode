import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { spawn } from "child_process"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "../config"
import { Instance } from "../project/instance"
import { Log } from "../util"
import { Effect } from "effect"

const log = Log.create({ service: "task-tool" })

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (c) => (stdout += c.toString()))
    proc.stderr?.on("data", (c) => (stderr += c.toString()))
    proc.on("error", () => resolve({ stdout, stderr, code: 1 }))
    proc.on("exit", (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

type Worktree = { dir: string; branch: string }

async function createWorktree(baseDir: string, subagent: string): Promise<Worktree | undefined> {
  try {
    const tmp = path.join(os.tmpdir(), `opencode-task-${subagent}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    const branch = `opencode/task/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const add = await git(baseDir, ["worktree", "add", "-b", branch, tmp, "HEAD"])
    if (add.code !== 0) {
      log.error("git worktree add failed", { baseDir, tmp, branch, stderr: add.stderr })
      return undefined
    }
    return { dir: tmp, branch }
  } catch (err) {
    log.error("worktree setup threw", { error: String(err) })
    return undefined
  }
}

async function cleanupWorktree(baseDir: string, wt: Worktree): Promise<{ clean: boolean; removed: boolean }> {
  const status = await git(wt.dir, ["status", "--porcelain"])
  const clean = status.code === 0 && status.stdout.trim() === ""
  if (!clean) return { clean: false, removed: false }
  const remove = await git(baseDir, ["worktree", "remove", wt.dir])
  if (remove.code !== 0) {
    // Fallback — force remove so we don't leak tmp dirs, but report it
    await git(baseDir, ["worktree", "remove", "--force", wt.dir])
    await fs.rm(wt.dir, { recursive: true, force: true }).catch(() => {})
  }
  await git(baseDir, ["branch", "-D", wt.branch]).catch(() => undefined)
  return { clean: true, removed: true }
}

export interface TaskPromptOps {
  cancel(sessionID: SessionID): void
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  isolation: z
    .enum(["worktree"])
    .describe(
      `Isolate this subagent's work inside a temporary git worktree. The worktree path and branch are included in the subagent's prompt so it can scope all edits there. If the worktree is clean at task completion it is automatically removed; otherwise the path and branch are reported back for you to act on. Requires a git repository.`,
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskTool.execute")(function* (params: z.infer<typeof parameters>, ctx: Tool.Context) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const messageID = MessageID.ascending()

      function cancel() {
        ops.cancel(nextSession.id)
      }

      // If the caller asked for worktree isolation, create one up front so
      // the path can be threaded into the subagent's prompt. Only new tasks
      // (not resumed via task_id) get a fresh worktree.
      const worktree =
        params.isolation === "worktree" && !session
          ? yield* Effect.promise(() => createWorktree(Instance.directory, next.name))
          : undefined

      const promptText =
        worktree === undefined
          ? params.prompt
          : [
              `You are running with worktree isolation. Perform ALL file edits inside:`,
              `  ${worktree.dir}`,
              `on branch \`${worktree.branch}\`. Use the \`workdir\` parameter on bash/edit/read tools so your changes land in that worktree, not the parent checkout.`,
              "",
              params.prompt,
            ].join("\n")

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", cancel)
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(promptText)
            const result = yield* ops.prompt({
              messageID,
              sessionID: nextSession.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              agent: next.name,
              tools: {
                ...(canTodo ? {} : { todowrite: false }),
                ...(canTask ? {} : { task: false }),
                ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
              },
              parts,
            })

            let worktreeNote = ""
            if (worktree) {
              const { clean, removed } = yield* Effect.promise(() => cleanupWorktree(Instance.directory, worktree))
              worktreeNote = removed
                ? `\n(worktree ${worktree.dir} was clean and has been removed; branch ${worktree.branch} deleted)`
                : `\n(worktree ${worktree.dir} left in place on branch \`${worktree.branch}\` — it contains ${clean ? "no" : "uncommitted"} changes; remove manually with \`git worktree remove${clean ? "" : " --force"} ${worktree.dir}\`)`
            }

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
                ...(worktree ? { worktree: worktree.dir, branch: worktree.branch } : {}),
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                ...(worktree ? [`worktree: ${worktree.dir}`, `branch: ${worktree.branch}`] : []),
                "",
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
                worktreeNote,
              ].join("\n"),
            }
          }),
        () =>
          Effect.sync(() => {
            ctx.abort.removeEventListener("abort", cancel)
          }),
      )
    })

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) => run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
