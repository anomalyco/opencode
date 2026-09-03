import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import { Option, Schema } from "effect"

const decodeInput = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))
const empty = {}

export function currentToolInput(tool: SessionMessageAssistantTool): Record<string, unknown> {
  if (tool.state.status !== "streaming") return tool.state.input
  return Option.getOrElse(decodeInput(tool.state.input), () => empty)
}

export function currentToolMetadata(tool: SessionMessageAssistantTool): Record<string, unknown> {
  if (!("metadata" in tool.state)) return empty
  return tool.state.metadata ?? empty
}

export function currentToolOutput(tool: SessionMessageAssistantTool) {
  if (tool.state.status === "running") {
    const output = tool.state.metadata.output
    return typeof output === "string" ? output : undefined
  }
  if (!("content" in tool.state) || !tool.state.content) return undefined
  const text = tool.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
  return text || undefined
}

export function currentToolError(tool: SessionMessageAssistantTool) {
  if (tool.state.status !== "error") return undefined
  return tool.state.error.message
}

export function currentToolFailed(tool: SessionMessageAssistantTool) {
  return (
    tool.state.status === "error" ||
    (tool.name === "execute" && executeToolFailed(currentToolMetadata(tool))) ||
    (tool.name === "shell" && tool.state.status === "completed" && shellResultFailed(currentToolMetadata(tool)))
  )
}

export function shellResultFailed(metadata: Record<string, unknown>) {
  // Shell completion reports the process outcome in metadata, not the tool status.
  return metadata.timeout === true || (typeof metadata.exit === "number" && metadata.exit !== 0)
}

export function executeToolFailed(metadata: Record<string, unknown>) {
  // Code Mode can report failed nested calls in a completed tool result.
  const calls = metadata.toolCalls
  return (
    metadata.error === true ||
    (Array.isArray(calls) &&
      calls.some(
        (call) =>
          call !== null &&
          typeof call === "object" &&
          !Array.isArray(call) &&
          "status" in call &&
          call.status === "error",
      ))
  )
}

export function currentToolHasLoadedFiles(tool: SessionMessageAssistantTool) {
  if (tool.name !== "read" || tool.state.status !== "completed") return false
  const loaded = tool.state.metadata?.loaded
  return Array.isArray(loaded) && loaded.some((path) => typeof path === "string")
}

export function currentContentDefaultOpen(
  content: SessionMessageAssistant["content"][number],
  shellExpanded: boolean,
  editExpanded: boolean,
) {
  if (content.type !== "tool") return undefined
  // Errored tools render the error card, which starts collapsed.
  if (content.state.status === "error") return false
  if (content.name === "shell" || content.name === "execute") return shellExpanded
  if (content.name === "patch") return editExpanded
  if (content.name !== "edit" && content.name !== "write") return undefined
  if (!editExpanded) return false
  const files = currentToolMetadata(content).files
  if (!Array.isArray(files) || files.length === 0) return true
  return !files.every((file) => !!file && typeof file === "object" && "status" in file && file.status === "deleted")
}
