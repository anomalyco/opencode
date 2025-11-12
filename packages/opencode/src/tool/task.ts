import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionLock } from "../session/lock"
import { SessionPrompt } from "../session/prompt"
import { TaskHierarchy } from "../session/task-hierarchy"
import { Parallel } from "../parallel"
import { Log } from "../util/log"

export const TaskTool = Tool.define("task", async () => {
  const log = Log.create({ service: "task-tool" })
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
  const description = DESCRIPTION.replace(
    "{agents}",
    agents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters: z.object({
      description: z.string().describe("A short (3-5 words) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z.string().describe("The type of specialized agent to use for this task"),
      parallel: z
        .boolean()
        .optional()
        .describe("Run subtask in isolated git worktree for parallel execution (requires git repository)"),
    }),
    async execute(params, ctx) {
      try {
        const agent = await Agent.get(params.subagent_type)
        if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

        // Setup parallel worktree if requested
        let parallelResult: Parallel.Result | undefined
        const originalCwd = process.cwd()

        try {
          // Create subtask using hierarchy system for proper state management
          // NOTE: Create the subtask BEFORE changing directories for parallel mode
          // This ensures Instance context is still valid for session creation
          const childSessionID = await TaskHierarchy.createSubtask(
            ctx.sessionID,
            agent.name,
            `[@${agent.name.toUpperCase()}] ${params.description}`,
          )

          // Setup parallel worktree AFTER creating the subtask
          if (params.parallel) {
            try {
              const isGitRepo = await Parallel.validateGitRepo(originalCwd)
              if (!isGitRepo) {
                log.warn("parallel mode requested but not in git repo", { cwd: originalCwd })
              } else {
                parallelResult = await Parallel.setup({
                  enabled: true,
                  prompt: params.description,
                  workspace: originalCwd,
                })
                // Validate worktreePath is a string before changing directory
                if (typeof parallelResult.worktreePath !== "string") {
                  throw new Error(`Invalid worktree path: expected string, got ${typeof parallelResult.worktreePath}`)
                }
                process.chdir(parallelResult.worktreePath)
                log.info("parallel worktree created", {
                  branch: parallelResult.branchName,
                  path: parallelResult.worktreePath,
                })
              }
            } catch (error) {
              log.error("parallel setup failed, continuing without isolation", {
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }

          const session = await Session.get(childSessionID)
          const messages = await Session.messages({ sessionID: ctx.sessionID })
          const msg = messages.find((m) => m.info.id === ctx.messageID)
          if (!msg) throw new Error("Message not found")
          if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

          ctx.metadata({
            title: params.description,
            metadata: {
              sessionId: session.id,
              parallel: params.parallel,
              branch: parallelResult?.branchName,
            },
          })

          const messageID = Identifier.ascending("message")
          const parts: Record<string, MessageV2.ToolPart> = {}
          const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
            if (evt.properties.part.sessionID !== session.id) return
            if (evt.properties.part.messageID === messageID) return
            if (evt.properties.part.type !== "tool") return
            parts[evt.properties.part.id] = evt.properties.part
            ctx.metadata({
              title: params.description,
              metadata: {
                summary: Object.values(parts).sort((a, b) => a.id?.localeCompare(b.id)),
                sessionId: session.id,
                parallel: params.parallel,
                branch: parallelResult?.branchName,
              },
            })
          })

          const model = agent.model ?? {
            modelID: msg.info.modelID,
            providerID: msg.info.providerID,
          }

          ctx.abort.addEventListener("abort", () => {
            SessionLock.abort(session.id)
          })

          const result = await SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: agent.name,
            tools: {
              todowrite: false,
              todoread: false,
              task: false,
              ...agent.tools,
            },
            parts: [
              {
                id: Identifier.ascending("part"),
                type: "text",
                text: params.prompt,
              },
            ],
          })
          unsub()

          let all
          all = await Session.messages({ sessionID: session.id })
          all = all.filter((x) => x.info.role === "assistant")
          all = all.flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])

          // Teardown parallel worktree if it was setup
          if (parallelResult) {
            try {
              await Parallel.teardown(parallelResult, true)
              process.chdir(originalCwd)
              log.info("parallel worktree cleaned up", { branch: parallelResult.branchName })
            } catch (error) {
              log.error("parallel teardown failed", {
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }

          return {
            title: params.description,
            metadata: {
              summary: all,
              sessionId: session.id,
              parallel: params.parallel,
              branch: parallelResult?.branchName,
            },
            output: (result.parts.findLast((x: any) => x.type === "text") as any)?.text ?? "",
          }
        } finally {
          // Ensure we always restore original directory
          if (parallelResult && process.cwd() !== originalCwd) {
            process.chdir(originalCwd)
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : ""
        log.error("task execution failed", {
          error: errorMsg,
          stack: errorStack,
          params,
        })
        // Write to file for debugging
        await Bun.write(
          "/tmp/opencode-task-error.log",
          `
Error: ${errorMsg}
Stack: ${errorStack}
Params: ${JSON.stringify(params, null, 2)}
Time: ${new Date().toISOString()}
        `,
        )
        throw error
      }
    },
  }
})
