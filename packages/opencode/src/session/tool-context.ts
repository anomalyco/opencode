import { Tool } from "@/tool/tool"
import { Session } from "."
import { PermissionNext } from "@/permission/next"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import type { SessionProcessor } from "./processor"
import type { MessageV2 } from "./message-v2"
import type { ToolCallOptions } from "ai"

/**
 * Factory functions for creating Tool.Context objects.
 * Centralizes the repeated "create a context" logic from prompt.ts
 * to eliminate 3-way duplication.
 */
export namespace ToolContext {
  /** Full context for normal tool calls — with permissions and metadata updates */
  export function forTool(input: {
    session: Session.Info
    processor: SessionProcessor.Info
    model: Provider.Model
    agent: Agent.Info
    messages: MessageV2.WithParts[]
    bypassAgentCheck: boolean
  }) {
    return (args: any, options: ToolCallOptions): Tool.Context => ({
      sessionID: input.session.id,
      abort: options.abortSignal ?? AbortSignal.timeout(10 * 60 * 1000),
      messageID: input.processor.message.id,
      callID: options.toolCallId,
      extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
      agent: input.agent.name,
      messages: input.messages,
      metadata: async (val: { title?: string; metadata?: any }) => {
        const match = input.processor.partFromToolCall(options.toolCallId)
        if (match && match.state.status === "running") {
          await Session.updatePart({
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: {
                start: Date.now(),
              },
            },
          })
        }
      },
      async ask(req) {
        await PermissionNext.ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
        })
      },
    })
  }

  /** Lightweight context for internal tool invocations (ReadTool, ListTool in createUserMessage) */
  export function internal(input: {
    sessionID: string
    messageID: string
    agent: string
    extra?: Record<string, any>
  }): Tool.Context {
    return {
      sessionID: input.sessionID,
      abort: new AbortController().signal,
      agent: input.agent,
      messageID: input.messageID,
      extra: input.extra ?? {},
      messages: [],
      // No-op: internal tool invocations don't need metadata or interactive ask
      metadata: async () => {},
      ask: async () => {},
    }
  }
}
