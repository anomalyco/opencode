import type { SessionUpdate } from "@agentclientprotocol/sdk"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { PartID } from "./schema"
import { DSHError } from "./dsh-client"

/** Projects ordered ACP updates into the same message parts consumed by the CLI and TUI. */
export class DSHProjection {
  readonly parts: SessionV1.Part[] = []
  private readonly tools = new Map<string, SessionV1.ToolPart>()

  constructor(
    readonly info: SessionV1.Assistant,
    private readonly save: (part: SessionV1.Part) => Promise<unknown>,
    private readonly delta: (part: SessionV1.Part, text: string) => Promise<unknown>,
  ) {}

  async update(update: SessionUpdate) {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        if (update.content.type !== "text") throw new DSHError("non-text assistant output is not supported by this adapter.")
        const type = update.sessionUpdate === "agent_message_chunk" ? "text" : "reasoning"
        const previous = this.parts.at(-1)
        if (previous?.type === type) {
          previous.text += update.content.text
          await this.delta(previous, update.content.text)
          return
        }
        const part: SessionV1.TextPart | SessionV1.ReasoningPart = {
          id: PartID.ascending(),
          sessionID: this.info.sessionID,
          messageID: this.info.id,
          type,
          text: update.content.text,
          time: { start: Date.now() },
        }
        this.parts.push(part)
        await this.save(part)
        return
      }
      case "tool_call": {
        if (this.tools.has(update.toolCallId)) throw new DSHError("duplicate tool call in runtime output.")
        const part: SessionV1.ToolPart = {
          id: PartID.ascending(),
          sessionID: this.info.sessionID,
          messageID: this.info.id,
          type: "tool",
          callID: update.toolCallId,
          // DSH tool arguments are opaque to OpenCode's specialized tool renderers.
          tool: "dsh",
          state: {
            status: "running",
            input: { title: update.title, arguments: update.rawInput },
            title: update.title,
            time: { start: Date.now() },
          },
        }
        this.tools.set(update.toolCallId, part)
        this.parts.push(part)
        await this.save(part)
        if (update.status === "completed" || update.status === "failed") {
          await this.update({ ...update, sessionUpdate: "tool_call_update" })
        }
        return
      }
      case "tool_call_update": {
        const part = this.tools.get(update.toolCallId)
        if (!part) throw new DSHError("tool update has no preceding tool call.")
        const output = (update.content ?? []).map((item) => {
          if (item.type === "content" && item.content.type === "text") return item.content.text
          if (item.type === "diff") return item.newText
          throw new DSHError("unsupported tool result content.")
        }).join("\n")
        const start = "time" in part.state ? part.state.time.start : Date.now()
        const title = update.title ?? ("title" in part.state ? part.state.title : undefined) ?? "DSH tool"
        if (update.status === "completed") {
          part.state = {
            status: "completed", input: part.state.input, output, title,
            metadata: {}, time: { start, end: Date.now() },
          }
        } else if (update.status === "failed") {
          part.state = {
            status: "error", input: part.state.input, error: output || "DSH tool failed",
            time: { start, end: Date.now() },
          }
        } else {
          part.state = { status: "running", input: part.state.input, title, time: { start } }
        }
        await this.save(part)
        return
      }
      case "config_option_update":
      case "usage_update":
      case "session_info_update":
        return
      default:
        throw new DSHError(`unsupported ACP update: ${update.sessionUpdate}`)
    }
  }

  async finish() {
    for (const part of this.parts) {
      if ((part.type === "text" || part.type === "reasoning") && part.time) part.time.end = Date.now()
      if (part.type === "tool" && (part.state.status === "pending" || part.state.status === "running")) {
        part.state = {
          status: "error", input: part.state.input, error: "DSH execution ended before this tool completed",
          time: { start: part.state.status === "running" ? part.state.time.start : Date.now(), end: Date.now() },
        }
      }
      await this.save(part)
    }
  }
}
