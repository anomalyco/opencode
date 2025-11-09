import { Tool } from "./tool"
import DESCRIPTION from "./add-task.txt"
import z from "zod"
import { Agent } from "../agent/agent"
import { TaskHierarchy } from "../session/task-hierarchy"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { Log } from "../util/log"
import { Session } from "../session"

export const AddTaskTool = Tool.define("add_task", async () => {
  const log = Log.create({ service: "add-task-tool" })
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
    }),
    async execute(params, ctx) {
      try {
        log.info("creating subagent task", { params })

        const agent = await Agent.get(params.subagent_type)
        if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

        // Create subtask
        const childSessionID = await TaskHierarchy.createSubtask(
          ctx.sessionID,
          agent.name,
          params.description + ` (@${agent.name} subagent)`,
        )

        log.info("created child session", { childSessionID })

        // Get current message info for model
        const messages = await Session.messages({ sessionID: ctx.sessionID })
        const msg = messages.find((m) => m.info.id === ctx.messageID)
        if (!msg) throw new Error("Message not found")
        if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

        const model = agent.model ?? {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        }

        // Send prompt to subagent
        ctx.abort.addEventListener("abort", () => {
          // Task can continue in background if aborted
          log.info("add_task aborted, task continues in background", { childSessionID })
        })

        const messageID = Identifier.ascending("message")
        await SessionPrompt.prompt({
          messageID,
          sessionID: childSessionID,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: agent.name,
          tools: {
            todowrite: false,
            todoread: false,
            task: false,
            add_task: false,
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

        log.info("subagent task created successfully", { childSessionID })

        return {
          title: params.description,
          metadata: {
            sessionId: childSessionID,
          },
          output: `Subagent task "${params.description}" created successfully. Session ID: ${childSessionID}`,
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : ""
        log.error("add_task failed", {
          error: errorMsg,
          stack: errorStack,
          params,
        })
        throw error
      }
    },
  }
})
