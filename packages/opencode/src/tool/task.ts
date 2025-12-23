import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { SessionRunner } from "../session/runner"
import { iife } from "@/util/iife"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { Storage } from "../storage/storage"

const log = Log.create({ service: "tool.task" })

export const TaskTool = Tool.define("task", async () => {
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
      session_id: z.string().describe("Existing Task session to continue").optional(),
      command: z.string().describe("The command that triggered this task").optional(),
    }),
    async execute(params, ctx) {
      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)
      const session = await iife(async () => {
        if (params.session_id) {
          const found = await Session.get(params.session_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const messageID = Identifier.ascending("message")
      const parts: Record<string, { id: string; tool: string; state: { status: string; title?: string } }> = {}

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)
      const config = await Config.get()

      const cancelChild = () => {
        SessionRunner.cancelBySession(session.id)
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancelChild, { once: true })

      // Helper to update parent tool part metadata (works after execute returns)
      const updateParentToolPart = async (metadata: {
        summary: typeof parts[string][]
        sessionId: string
        jobId?: string
        status?: string
      }) => {
        if (!ctx.toolPartID) return
        const currentPart = await Storage.read<MessageV2.ToolPart>(["part", ctx.messageID, ctx.toolPartID]).catch(
          (err) => {
            log.warn("failed to read parent tool part", { error: err, partID: ctx.toolPartID })
            return undefined
          },
        )
        if (!currentPart || currentPart.type !== "tool") return
        // Skip pending (no metadata field) and error (terminal state)
        if (currentPart.state.status === "pending" || currentPart.state.status === "error") return
        await Session.updatePart({
          ...currentPart,
          state: {
            ...currentPart.state,
            metadata,
          },
        }).catch((err) => log.warn("failed to update parent tool part", { error: err }))
      }

      // Subscribe to child session part updates for live progress
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        if (evt.properties.part.type !== "tool") return
        const part = evt.properties.part
        parts[part.id] = {
          id: part.id,
          tool: part.tool,
          state: {
            status: part.state.status,
            title: part.state.status === "completed" ? part.state.title : undefined,
          },
        }
        await updateParentToolPart({
          summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
          sessionId: session.id,
        })
      })

      // Cleanup function for all subscriptions
      const cleanup = () => {
        unsub()
        ctx.abort.removeEventListener("abort", cancelChild)
      }

      // Subscribe to job lifecycle events for cleanup and status updates
      const jobEvents = [
        SessionRunner.Event.Completed,
        SessionRunner.Event.Failed,
        SessionRunner.Event.Canceled,
        SessionRunner.Event.TimedOut,
      ] as const
      const jobUnsubs = jobEvents.map((event) =>
        Bus.subscribe(event, async (evt) => {
          if (evt.properties.job.targetSessionID !== session.id) return
          const job = evt.properties.job
          // Update parent metadata with final status
          await updateParentToolPart({
            summary: Object.values(parts).sort((a, b) => a.id.localeCompare(b.id)),
            sessionId: session.id,
            status: job.status,
          })
          if (job.status !== "completed") {
            log.info("child session job ended", { jobId: job.id, status: job.status, error: job.error })
          }
          cleanup()
          jobUnsubs.forEach((u) => u())
        }),
      )

      // Enqueue the child session work (fire-and-forget)
      SessionRunner.enqueue(
        "task.child_session",
        session.id,
        async () => {
          await SessionPrompt.prompt({
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
              ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
              ...agent.tools,
            },
            parts: promptParts,
          })
        },
        {
          parentSessionID: ctx.sessionID,
          toolCallID: ctx.callID ?? ctx.messageID,
        },
      ).catch((err) => {
        log.error("failed to enqueue child session", { error: err, sessionID: session.id })
        cleanup()
        jobUnsubs.forEach((u) => u())
      })

      // Return immediately without waiting for job completion
      return {
        title: params.description,
        metadata: {
          summary: [] as (typeof parts)[string][],
          sessionId: session.id,
          status: "running",
        },
        output: `Task started in background.\n\n<task_metadata>\nsession_id: ${session.id}\n</task_metadata>`,
      }
    },
  }
})
