import type { SessionUpdate } from "@agentclientprotocol/sdk"
import type { OpenCodeClient } from "@opencode/client/effect"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Effect, Option, Stream } from "effect"
import type { Capabilities } from "./capabilities"
import { ACPClient } from "./client"
import { ACPCompaction } from "./compaction"
import type { ACPConnection } from "./connection"
import { partsToContentChunks } from "./content"
import type { Attached } from "./sessions"
import { ACPTranslate } from "./translate"
import { completedToolUpdate, errorToolUpdate, pendingToolCall, runningToolUpdate } from "./tool"

export function history(
  client: OpenCodeClient,
  connection: ACPConnection.Interface,
  attached: Attached,
  capabilities: Capabilities,
) {
  return Stream.paginate(undefined, (cursor: string | undefined) =>
    (cursor
      ? client.message.list({ sessionID: attached.id, limit: 200, cursor })
      : client.message.list({ sessionID: attached.id, limit: 200, order: "asc" })
    ).pipe(
      Effect.catch(ACPClient.classify),
      Effect.map((page) => [page.data, Option.fromNullishOr(page.cursor.next)] as const),
    ),
  ).pipe(
    Stream.runForEach((message) =>
      Effect.forEach(
        updates(message, attached.cwd, capabilities),
        (update) => connection.sessionUpdate({ sessionId: attached.id, update }),
        { discard: true },
      ),
    ),
  )
}

export function updates(message: SessionMessage.Info, cwd: string, capabilities: Capabilities): SessionUpdate[] {
  if (message.type === "user")
    return [
      { sessionUpdate: "user_message_chunk", messageId: message.id, content: { type: "text", text: message.text } },
      ...partsToContentChunks(
        (message.files ?? []).map((file) => ({
          type: "file",
          url: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
          filename: file.name,
          mime: file.mime,
        })),
      ).map((chunk) => ({ sessionUpdate: "user_message_chunk" as const, messageId: message.id, ...chunk })),
    ]
  if (message.type === "compaction") {
    const update = ACPCompaction.replay(message, capabilities.compaction)
    return update ? [update] : []
  }
  if (message.type !== "assistant") return []
  // Live reasoning ordinals count only reasoning parts, not the mixed content array.
  const reasoning = message.content.filter((part) => part.type === "reasoning")
  return message.content.flatMap((part): SessionUpdate[] => {
    if (part.type === "text")
      return [
        { sessionUpdate: "agent_message_chunk", messageId: message.id, content: { type: "text", text: part.text } },
      ]
    if (part.type === "reasoning")
      return [
        {
          sessionUpdate: "agent_thought_chunk",
          messageId: ACPTranslate.reasoningMessageID(message.id, reasoning.indexOf(part)),
          content: { type: "text", text: part.text },
        },
      ]
    const call: SessionUpdate = {
      sessionUpdate: "tool_call",
      ...pendingToolCall({
        toolCallId: part.id,
        toolName: part.name,
        state: { input: part.state.status === "streaming" ? {} : part.state.input },
        cwd,
      }),
    }
    switch (part.state.status) {
      case "completed":
        return [
          call,
          {
            sessionUpdate: "tool_call_update",
            ...completedToolUpdate({
              toolCallId: part.id,
              toolName: part.name,
              input: part.state.input,
              metadata: part.state.metadata,
              content: part.state.content,
              cwd,
            }),
          },
        ]
      case "running":
        return [
          call,
          {
            sessionUpdate: "tool_call_update",
            ...runningToolUpdate({ toolCallId: part.id, toolName: part.name, state: { input: part.state.input }, cwd }),
          },
        ]
      case "error":
        return [
          call,
          {
            sessionUpdate: "tool_call_update",
            ...errorToolUpdate({
              toolCallId: part.id,
              toolName: part.name,
              input: part.state.input,
              metadata: part.state.metadata,
              content: part.state.content,
              error: part.state.error.message,
              cwd,
            }),
          },
        ]
      case "streaming":
        return [call]
    }
  })
}

export * as ACPReplay from "./replay"
