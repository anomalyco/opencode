import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import type {
  Event,
  EventMessagePartDelta,
  EventMessagePartUpdated,
  OpencodeClient,
  Part,
  SessionMessageResponse,
  ToolPart,
} from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import { ACPNextSession } from "./session"
import {
  duplicateRunningToolUpdate,
  errorToolUpdate,
  pendingToolCall,
  runningToolUpdate,
  shellOutputSnapshot,
  completedToolUpdate,
} from "./tool"

const log = Log.create({ service: "acp-next-event" })

type Connection = Pick<AgentSideConnection, "sessionUpdate">
type GlobalEventEnvelope = {
  payload?: Event
}
type GlobalEventStream = {
  stream: AsyncIterable<GlobalEventEnvelope>
}

export function start(input: { sdk: OpencodeClient; connection: Connection; session: ACPNextSession.Interface }) {
  const subscription = new Subscription(input)
  subscription.start()
  return subscription
}

export class Subscription {
  private readonly abort = new AbortController()
  private readonly shellSnapshots = new Map<string, string>()
  private readonly toolStarts = new Set<string>()
  private readonly streamedText = new Map<string, string>()
  private started = false

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPNextSession.Interface
    },
  ) {}

  start() {
    if (this.started) return
    this.started = true
    this.run().catch((error: unknown) => {
      if (this.abort.signal.aborted) return
      log.error("event subscription failed", { error })
    })
  }

  stop() {
    this.abort.abort()
  }

  async handle(event: Event) {
    switch (event.type) {
      case "message.part.updated":
        return this.handlePartUpdated(event)
      case "message.part.delta":
        return this.handlePartDelta(event)
    }
  }

  async replayMessage(message: SessionMessageResponse) {
    if (message.info.role !== "assistant" && message.info.role !== "user") return

    for (const part of message.parts) {
      await this.recordFetchedPart(message.info.sessionID, message, part)
      if (part.type === "tool") {
        await this.handleToolPart(message.info.sessionID, part)
      }
    }
  }

  private async run() {
    while (!this.abort.signal.aborted) {
      const events = (await this.input.sdk.global.event({
        signal: this.abort.signal,
      })) as GlobalEventStream

      for await (const event of events.stream) {
        if (this.abort.signal.aborted) return
        if (!event.payload) continue
        await this.handle(event.payload).catch((error: unknown) => {
          log.error("failed to handle event", { error, type: event.payload?.type })
        })
      }
      if (!this.abort.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  private async handlePartUpdated(event: EventMessagePartUpdated) {
    const part = event.properties.part
    const sessionId = part.sessionID || event.properties.sessionID
    const session = await Effect.runPromise(this.input.session.tryGet(sessionId))
    if (!session) return
    const known = await Effect.runPromise(
      this.input.session.tryGetPartMetadata({
        sessionId: session.id,
        messageId: part.messageID,
        partId: part.id,
      }),
    )

    await Effect.runPromise(
      this.input.session.recordPartMetadata({
        sessionId: session.id,
        messageId: part.messageID,
        partId: part.id,
        partType: part.type,
        role: part.type === "reasoning" ? "assistant" : known?.role,
        ignored: part.type === "text" ? part.ignored : undefined,
        toolCallId: part.type === "tool" ? part.callID : undefined,
        metadata: "metadata" in part ? part.metadata : undefined,
      }),
    )
    if (part.type === "text" || part.type === "reasoning") {
      if (known?.role !== "assistant") return
      if (known.partType !== part.type) return
      if (part.type === "text" && (known.ignored === true || part.ignored === true)) return
      await this.flushUpdatedText(session.id, part.messageID, part.id, part.type, part.text)
      return
    }
    if (part.type === "tool") {
      await this.handleToolPart(session.id, part)
    }
  }

  private async handlePartDelta(event: EventMessagePartDelta) {
    const props = event.properties
    const session = await Effect.runPromise(this.input.session.tryGet(props.sessionID))
    if (!session) return

    const known = await Effect.runPromise(
      this.input.session.tryGetPartMetadata({
        sessionId: session.id,
        messageId: props.messageID,
        partId: props.partID,
      }),
    )
    const metadata =
      known?.role && known.partType
        ? known
        : await this.fetchPartMetadata(session.id, session.cwd, props.messageID, props.partID)
    if (metadata?.role !== "assistant") return
    if (metadata.partType === "text" && props.field === "text" && metadata.ignored !== true) {
      await this.input.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: props.messageID,
          content: {
            type: "text",
            text: props.delta,
          },
        },
      })
      this.appendStreamedText(session.id, props.messageID, props.partID, props.delta)
      return
    }

    if (metadata.partType === "reasoning" && props.field === "text") {
      await this.input.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: props.messageID,
          content: {
            type: "text",
            text: props.delta,
          },
        },
      })
      this.appendStreamedText(session.id, props.messageID, props.partID, props.delta)
    }
  }

  private async flushUpdatedText(
    sessionId: string,
    messageId: string,
    partId: string,
    partType: "text" | "reasoning",
    text: string,
  ) {
    const key = this.streamedTextKey(sessionId, messageId, partId)
    const streamed = this.streamedText.get(key) ?? ""
    if (!text.startsWith(streamed)) return
    const delta = text.slice(streamed.length)
    if (delta.length === 0) return

    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: partType === "text" ? "agent_message_chunk" : "agent_thought_chunk",
        messageId,
        content: {
          type: "text",
          text: delta,
        },
      },
    })
    this.streamedText.set(key, text)
  }

  private appendStreamedText(sessionId: string, messageId: string, partId: string, delta: string) {
    const key = this.streamedTextKey(sessionId, messageId, partId)
    this.streamedText.set(key, (this.streamedText.get(key) ?? "") + delta)
  }

  private streamedTextKey(sessionId: string, messageId: string, partId: string) {
    return `${sessionId}:${messageId}:${partId}`
  }

  private async fetchPartMetadata(sessionId: string, cwd: string, messageId: string, partId: string) {
    const message = await this.input.sdk.session
      .message(
        {
          sessionID: sessionId,
          messageID: messageId,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((response) => response.data)
      .catch((error: unknown) => {
        log.error("unexpected error when fetching message for delta metadata", { error, messageId, partId })
        return undefined
      })
    if (!message) return

    const part = message.parts.find((item) => item.id === partId)
    if (!part) return
    return await this.recordFetchedPart(sessionId, message, part)
  }

  private async recordFetchedPart(sessionId: string, message: SessionMessageResponse, part: Part) {
    return await Effect.runPromise(
      this.input.session.recordPartMetadata({
        sessionId,
        messageId: part.messageID,
        partId: part.id,
        partType: part.type,
        role: message.info.role,
        ignored: part.type === "text" ? part.ignored : undefined,
        toolCallId: part.type === "tool" ? part.callID : undefined,
        metadata: "metadata" in part ? part.metadata : undefined,
      }),
    )
  }

  private async handleToolPart(sessionId: string, part: ToolPart) {
    await this.toolStart(sessionId, part)

    switch (part.state.status) {
      case "pending":
        this.shellSnapshots.delete(part.callID)
        return

      case "running":
        await this.runningTool(sessionId, part)
        return

      case "completed":
        this.clearTool(part.callID)
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...completedToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
            }),
          },
        })
        return

      case "error":
        this.clearTool(part.callID)
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...errorToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
            }),
          },
        })
        return
    }
  }

  private async runningTool(sessionId: string, part: ToolPart) {
    if (part.state.status !== "running") return

    const output = part.tool === "bash" ? shellOutputSnapshot(part.state) : undefined
    if (output !== undefined) {
      if (this.shellSnapshots.get(part.callID) === output) {
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...duplicateRunningToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
            }),
          },
        })
        return
      }
      this.shellSnapshots.set(part.callID, output)
    }

    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        ...runningToolUpdate({
          toolCallId: part.callID,
          toolName: part.tool,
          state: part.state,
          output,
        }),
      },
    })
  }

  private async toolStart(sessionId: string, part: ToolPart) {
    if (this.toolStarts.has(part.callID)) return
    this.toolStarts.add(part.callID)
    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        ...pendingToolCall({
          toolCallId: part.callID,
          toolName: part.tool,
        }),
      },
    })
  }

  private clearTool(toolCallId: string) {
    this.toolStarts.delete(toolCallId)
    this.shellSnapshots.delete(toolCallId)
  }
}

export * as ACPNextEvent from "./event"
