import { z } from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { RemoteDiscovery } from "./discovery"
import { Instance } from "../project/instance"
import { Bus } from "../bus"

export namespace RemoteStream {
  export const PromptRequest = z.object({
    session_id: z.string().optional(),
    prompt: z.string(),
    attachments: z
      .array(
        z.object({
          type: z.literal("file"),
          path: z.string(),
          content: z.string(),
        }),
      )
      .optional(),
  })
  export type PromptRequest = z.infer<typeof PromptRequest>

  export const PromptResponse = z.object({
    session_id: z.string(),
    stream_url: z.string(),
  })
  export type PromptResponse = z.infer<typeof PromptResponse>

  export type StreamEvent =
    | { type: "text"; delta: string }
    | { type: "reasoning"; delta: string }
    | { type: "tool_start"; id: string; name: string; input: unknown }
    | { type: "tool_result"; id: string; status: "completed" | "error"; output: string; error?: string }
    | { type: "step_start"; step_id: string }
    | { type: "step_finish"; step_id: string; tokens?: { input: number; output: number } }
    | { type: "error"; message: string; code: string }
    | { type: "done"; stop_reason: string }

  interface StreamContext {
    session: Session.Info
    messageID: string
    parentMessageID: string
    abort: AbortSignal
    onToolUpdate?: (summary: ToolSummary[]) => void
  }

  interface ToolSummary {
    id: string
    tool: string
    state: { status: string; title?: string }
  }

  export async function invoke(
    domain: string,
    agentInfo: RemoteDiscovery.AgentInfo,
    prompt: string,
    ctx: StreamContext,
  ): Promise<MessageV2.WithParts> {
    const endpointUrl = RemoteDiscovery.buildEndpointUrl(domain, agentInfo.endpoint)
    const promptUrl = `${endpointUrl}/prompt`

    const promptResponse = await fetch(promptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt } satisfies PromptRequest),
      signal: ctx.abort,
    })

    if (!promptResponse.ok) {
      throw new Error(`Remote agent prompt failed: ${promptResponse.status} ${promptResponse.statusText}`)
    }

    const promptData = PromptResponse.parse(await promptResponse.json())
    const streamUrl = RemoteDiscovery.buildEndpointUrl(domain, promptData.stream_url)

    const assistantMsg: MessageV2.Assistant = {
      id: ctx.messageID,
      sessionID: ctx.session.id,
      role: "assistant",
      time: { created: Date.now() },
      parentID: ctx.parentMessageID,
      modelID: "remote",
      providerID: domain,
      mode: "remote",
      agent: `${domain}:${agentInfo.name}`,
      path: {
        cwd: Instance.worktree,
        root: Instance.worktree,
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    }
    await Session.updateMessage(assistantMsg)

    let currentTextPart: MessageV2.TextPart | undefined
    let currentReasoningPart: MessageV2.ReasoningPart | undefined
    const toolParts = new Map<string, MessageV2.ToolPart>()
    const toolSummary: ToolSummary[] = []

    const response = await fetch(streamUrl, {
      headers: { Accept: "text/event-stream" },
      signal: ctx.abort,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Remote agent stream failed: ${response.status} ${response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        let currentEvent = ""
        let currentData = ""

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6)
          } else if (line === "" && currentEvent && currentData) {
            const event = parseEvent(currentEvent, currentData)
            if (event) {
              const result = await handleEvent(event, {
                session: ctx.session,
                messageID: ctx.messageID,
                currentTextPart,
                currentReasoningPart,
                toolParts,
                toolSummary,
                onToolUpdate: ctx.onToolUpdate,
              })
              if (result.textPart !== undefined) currentTextPart = result.textPart
              if (result.reasoningPart !== undefined) currentReasoningPart = result.reasoningPart
            }
            currentEvent = ""
            currentData = ""
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (currentTextPart && currentTextPart.time) {
      currentTextPart.time.end = Date.now()
      await Session.updatePart({ part: currentTextPart, delta: "" })
    }

    assistantMsg.time.completed = Date.now()
    await Session.updateMessage(assistantMsg)

    return MessageV2.get({ sessionID: ctx.session.id, messageID: ctx.messageID })
  }

  function parseEvent(eventType: string, data: string): StreamEvent | null {
    try {
      const parsed = JSON.parse(data)
      return { type: eventType, ...parsed } as StreamEvent
    } catch {
      return null
    }
  }

  interface EventHandlerContext {
    session: Session.Info
    messageID: string
    currentTextPart: MessageV2.TextPart | undefined
    currentReasoningPart: MessageV2.ReasoningPart | undefined
    toolParts: Map<string, MessageV2.ToolPart>
    toolSummary: ToolSummary[]
    onToolUpdate?: (summary: ToolSummary[]) => void
  }

  interface EventHandlerResult {
    textPart?: MessageV2.TextPart | undefined
    reasoningPart?: MessageV2.ReasoningPart | undefined
  }

  async function handleEvent(event: StreamEvent, ctx: EventHandlerContext): Promise<EventHandlerResult> {
    const result: EventHandlerResult = {}

    switch (event.type) {
      case "text": {
        if (!ctx.currentTextPart) {
          const part: MessageV2.TextPart = {
            id: Identifier.ascending("part"),
            messageID: ctx.messageID,
            sessionID: ctx.session.id,
            type: "text",
            text: event.delta,
            time: { start: Date.now() },
          }
          result.textPart = part
          await Session.updatePart({ part, delta: event.delta })
        } else {
          ctx.currentTextPart.text += event.delta
          result.textPart = ctx.currentTextPart
          await Session.updatePart({ part: ctx.currentTextPart, delta: event.delta })
        }
        break
      }

      case "reasoning": {
        if (!ctx.currentReasoningPart) {
          const part: MessageV2.ReasoningPart = {
            id: Identifier.ascending("part"),
            messageID: ctx.messageID,
            sessionID: ctx.session.id,
            type: "reasoning",
            text: event.delta,
            time: { start: Date.now() },
          }
          result.reasoningPart = part
          await Session.updatePart({ part, delta: event.delta })
        } else {
          ctx.currentReasoningPart.text += event.delta
          result.reasoningPart = ctx.currentReasoningPart
          await Session.updatePart({ part: ctx.currentReasoningPart, delta: event.delta })
        }
        break
      }

      case "tool_start": {
        const inputObj = typeof event.input === "object" && event.input !== null ? (event.input as Record<string, unknown>) : {}
        const part: MessageV2.ToolPart = {
          id: Identifier.ascending("part"),
          messageID: ctx.messageID,
          sessionID: ctx.session.id,
          type: "tool",
          callID: event.id,
          tool: event.name,
          state: {
            status: "running",
            input: inputObj as Record<string, any>,
            time: { start: Date.now() },
          },
        }
        ctx.toolParts.set(event.id, part)
        await Session.updatePart(part)

        ctx.toolSummary.push({
          id: part.id,
          tool: event.name,
          state: { status: "running" },
        })
        ctx.onToolUpdate?.(ctx.toolSummary)
        break
      }

      case "tool_result": {
        const part = ctx.toolParts.get(event.id)
        if (part && part.state.status === "running") {
          const now = Date.now()
          if (event.status === "completed") {
            part.state = {
              status: "completed",
              input: part.state.input,
              output: event.output,
              title: "Completed",
              metadata: {},
              time: { start: part.state.time.start, end: now },
            }
          } else {
            part.state = {
              status: "error",
              input: part.state.input,
              error: event.error || event.output,
              time: { start: part.state.time.start, end: now },
            }
          }
          await Session.updatePart(part)

          const summaryIdx = ctx.toolSummary.findIndex((t) => t.id === part.id)
          if (summaryIdx >= 0) {
            ctx.toolSummary[summaryIdx].state = {
              status: part.state.status,
              title: part.state.status === "completed" ? (part.state as MessageV2.ToolStateCompleted).title : undefined,
            }
            ctx.onToolUpdate?.(ctx.toolSummary)
          }
        }
        break
      }

      case "error": {
        throw new Error(`Remote agent error: ${event.message} (${event.code})`)
      }

      case "done": {
        break
      }
    }

    return result
  }
}
