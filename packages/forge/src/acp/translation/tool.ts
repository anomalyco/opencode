import type { SessionNotification, ToolCallStatus } from "@agentclientprotocol/sdk"
import { MessageV2 } from "../../session/message-v2"
import { Session } from "../../session"
import { Storage } from "../../storage/storage"
import { Identifier } from "../../id/id"
import { Log } from "../../util/log"

const log = Log.create({ service: "acp-tool-translator" })

/**
 * Map ACP tool call status to forge ToolPart status (1:1 mapping)
 */
function mapStatus(acpStatus?: ToolCallStatus): MessageV2.ToolPart["state"]["status"] {
  switch (acpStatus) {
    case "pending":
      return "pending"
    case "in_progress":
      return "running"
    case "completed":
      return "completed"
    case "failed":
      return "error"
    default:
      return "pending"
  }
}

/**
 * Map ACP tool call status to forge ToolPart status (nullable for updates)
 */
function mapStatusNullable(acpStatus?: ToolCallStatus | null): MessageV2.ToolPart["state"]["status"] | null {
  if (acpStatus === null || acpStatus === undefined) return null
  switch (acpStatus) {
    case "pending":
      return "pending"
    case "in_progress":
      return "running"
    case "completed":
      return "completed"
    case "failed":
      return "error"
  }
}

/**
 * Handle initial tool_call notification
 */
export async function handleToolCall(
  sessionID: string,
  messageID: string,
  notification: SessionNotification,
  toolCallMap: Map<string, string>,
): Promise<void> {
  if (notification.update.sessionUpdate !== "tool_call") return
  const update = notification.update

  log.info("    ┌─ [TOOL_CALL]", {
    toolCallId: update.toolCallId,
    kind: update.kind,
    title: update.title,
    status: update.status,
  })

  // Create new ToolPart for this tool call
  const partID = Identifier.ascending("part")
  toolCallMap.set(update.toolCallId, partID)

  const status = mapStatus(update.status)

  const toolPart: MessageV2.ToolPart = {
    id: partID,
    sessionID,
    messageID,
    type: "tool",
    callID: update.toolCallId,
    tool: update.kind || "other",
    state:
      status === "pending"
        ? {
            status: "pending",
            input: update.rawInput || {},
            raw: update.title,
          }
        : status === "completed"
          ? {
              status: "completed",
              title: update.title,
              metadata: {
                kind: update.kind,
                content: update.content,
                locations: update.locations,
                rawInput: update.rawInput,
                rawOutput: update.rawOutput,
              },
              input: update.rawInput || {},
              output: JSON.stringify(update.rawOutput || {}),
              time: { start: Date.now(), end: Date.now() },
              attachments: [],
            }
          : status === "error"
            ? {
                status: "error",
                metadata: {
                  kind: update.kind,
                  content: update.content,
                  locations: update.locations,
                  rawInput: update.rawInput,
                  rawOutput: update.rawOutput,
                },
                input: update.rawInput || {},
                error: String(update.rawOutput?.error ?? "Tool execution failed"),
                time: { start: Date.now(), end: Date.now() },
              }
            : {
                status: "running",
                title: update.title,
                metadata: {
                  kind: update.kind,
                  content: update.content,
                  locations: update.locations,
                  rawInput: update.rawInput,
                  rawOutput: update.rawOutput,
                },
                input: update.rawInput || {},
                time: { start: Date.now() },
              },
  }

  log.info("    │  [TOOL_CALL] calling Session.updatePart...")
  await Session.updatePart(toolPart)
  log.info("    └─ [TOOL_CALL] Session.updatePart complete", {
    toolCallId: update.toolCallId,
    partID,
    status: update.status,
  })
}

/**
 * Handle tool_call_update notification
 */
export async function handleToolCallUpdate(
  sessionID: string,
  messageID: string,
  notification: SessionNotification,
  toolCallMap: Map<string, string>,
): Promise<void> {
  if (notification.update.sessionUpdate !== "tool_call_update") return
  const update = notification.update

  log.info("    ┌─ [TOOL_UPDATE]", {
    toolCallId: update.toolCallId,
    status: update.status,
    hasContent: !!update.content,
  })

  // Find existing tool part
  const partID = toolCallMap.get(update.toolCallId)
  if (!partID) {
    log.warn("    └─ [TOOL_UPDATE] unknown toolCallId", {
      sessionID,
      toolCallId: update.toolCallId,
    })
    return
  }

  // Get existing part from storage
  log.info("    │  [TOOL_UPDATE] reading from storage...")
  const existingPartData = await Storage.read(["part", messageID, partID])
  log.info("    │  [TOOL_UPDATE] storage read complete")
  const existingPart = existingPartData ? MessageV2.Part.parse(existingPartData) : null
  if (!existingPart || existingPart.type !== "tool") {
    log.warn("existing part not found or not a tool part", {
      sessionID,
      partID,
      toolCallId: update.toolCallId,
    })
    return
  }

  // Merge updates into existing metadata (only for states that have metadata)
  const existingMetadata = (existingPart.state.status !== "pending" ? existingPart.state.metadata : undefined) || {}
  const mergedMetadata = {
    ...existingMetadata,
    ...(update.kind !== null && update.kind !== undefined && { kind: update.kind }),
    ...(update.rawInput !== null && update.rawInput !== undefined && { rawInput: update.rawInput }),
    ...(update.rawOutput !== null && update.rawOutput !== undefined && { rawOutput: update.rawOutput }),
    // Append content if provided, otherwise keep existing
    content:
      update.content !== null && update.content !== undefined
        ? [...(existingMetadata.content || []), ...update.content]
        : existingMetadata.content,
    // Replace locations if provided
    locations:
      update.locations !== null && update.locations !== undefined ? update.locations : existingMetadata.locations,
  }

  const newStatus = mapStatusNullable(update.status)
  const status = newStatus || existingPart.state.status
  const title =
    update.title !== null && update.title !== undefined
      ? update.title
      : existingPart.state.status === "running" || existingPart.state.status === "completed"
        ? existingPart.state.title
        : undefined

  // Helper to get start time from existing part
  const getStartTime = (): number => {
    if (
      existingPart.state.status === "running" ||
      existingPart.state.status === "completed" ||
      existingPart.state.status === "error"
    ) {
      return existingPart.state.time.start
    }
    return Date.now()
  }

  // Create updated part with new state
  const updatedPart: MessageV2.ToolPart = {
    ...existingPart,
    state:
      status === "pending"
        ? {
            status: "pending",
            input: mergedMetadata.rawInput || existingPart.state.input,
            raw: title || (existingPart.state.status === "pending" ? existingPart.state.raw : ""),
          }
        : status === "completed"
          ? {
              status: "completed",
              title: title || "",
              metadata: mergedMetadata,
              input: mergedMetadata.rawInput || existingPart.state.input,
              output: JSON.stringify(mergedMetadata.rawOutput || {}),
              time: {
                start: getStartTime(),
                end: Date.now(),
              },
              attachments: existingPart.state.status === "completed" ? existingPart.state.attachments : [],
            }
          : status === "error"
            ? {
                status: "error",
                metadata: mergedMetadata,
                input: mergedMetadata.rawInput || existingPart.state.input,
                error: String(
                  mergedMetadata.rawOutput?.error ??
                    (existingPart.state.status === "error" ? existingPart.state.error : "Tool execution failed"),
                ),
                time: {
                  start: getStartTime(),
                  end: Date.now(),
                },
              }
            : {
                status: "running",
                title,
                metadata: mergedMetadata,
                input: mergedMetadata.rawInput || existingPart.state.input,
                time: existingPart.state.status === "running" ? existingPart.state.time : { start: Date.now() },
              },
  }

  log.info("    │  [TOOL_UPDATE] calling Session.updatePart...")
  await Session.updatePart(updatedPart)
  log.info("    └─ [TOOL_UPDATE] Session.updatePart complete", {
    toolCallId: update.toolCallId,
    partID,
    status: newStatus || existingPart.state.status,
    contentAdded: update.content?.length || 0,
  })
}
