import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { Option, Predicate, Schema } from "effect"
import type { ToolProps } from "../tools/tool-renderer"

const decodeInput = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject))

const empty: Schema.JsonObject = {}

export function currentToolInput(tool: SessionMessageAssistantTool) {
  if (tool.state.status !== "streaming") return tool.state.input

  return Option.getOrElse(decodeInput(tool.state.input), () => empty)
}

export function currentToolMetadata(tool: SessionMessageAssistantTool) {
  if (!("metadata" in tool.state)) return empty

  return tool.state.metadata ?? empty
}

export function currentToolOutput(tool: SessionMessageAssistantTool) {
  if (tool.state.status === "running") {
    const output = tool.state.metadata.output

    return Predicate.isString(output) ? output : undefined
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

export function shellResultFailed(metadata: Schema.JsonObject) {
  // Shell completion reports the process outcome in metadata, not the tool status.
  return metadata.timeout === true || (Predicate.isNumber(metadata.exit) && metadata.exit !== 0)
}

function executeToolFailed(metadata: Schema.JsonObject) {
  return metadata.error === true || executeToolErrorIndex(metadata) >= 0
}

const decodeExecuteCall = Schema.decodeUnknownOption(
  Schema.Struct({
    tool: Schema.String,
    status: Schema.Literals(["running", "completed", "error"]),
    input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
)

export type ExecuteToolCall = Option.Option.Value<ReturnType<typeof decodeExecuteCall>>

// Code Mode streams the tools a script calls through metadata rather than child tool parts. A script can make thousands
// of calls, so readers count and search them as they are and decode only the calls they show.
function executeToolCallList(metadata: ToolProps["metadata"]): readonly unknown[] {
  const calls = metadata.toolCalls

  return Array.isArray(calls) ? calls : []
}

export function executeToolCallCount(metadata: ToolProps["metadata"]) {
  return executeToolCallList(metadata).length
}

/** The position of the last call that failed, or -1. */
export function executeToolErrorIndex(metadata: ToolProps["metadata"]) {
  return executeToolCallList(metadata).findLastIndex(callFailed)
}

/** The calls from `start` on, each with its position among all of them. */
export function executeToolCalls(metadata: ToolProps["metadata"], start = 0) {
  return executeToolCallList(metadata)
    .slice(start)
    .flatMap((call, offset) =>
      Option.toArray(decodeExecuteCall(call)).map((value) => ({ index: start + offset, call: value })),
    )
}

// Matches only calls the rows can decode, so a failure is never counted on a call that shows nowhere.
const callFailed = Schema.is(Schema.Struct({ tool: Schema.String, status: Schema.Literal("error") }))

const isCallArg = Schema.is(Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))

export function executeToolCallArgs(call: ExecuteToolCall) {
  return Object.entries(call.input ?? {})
    .filter(([, value]) => isCallArg(value))
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, " ")}`)
}

/** How many times a script called each tool, in the order it first called them. */
export function executeToolCounts(metadata: ToolProps["metadata"]) {
  const counts = new Map<string, number>()

  executeToolCallList(metadata).forEach((value) =>
    Option.toArray(decodeExecuteCall(value)).forEach((call) => {
      // A script calls a namespaced tool by its path; its own name reads better.
      const tool = call.tool.split(".").at(-1) ?? call.tool
      counts.set(tool, (counts.get(tool) ?? 0) + 1)
    }),
  )

  return Array.from(counts, ([tool, count]) => ({ tool, count }))
}

// Collapsed rows name the failed call, or else the latest one.
export function executeToolSubtitle(metadata: ToolProps["metadata"]) {
  const calls = executeToolCallList(metadata)
  const failed = calls.findIndex(callFailed)
  const call = Option.getOrUndefined(decodeExecuteCall(calls[failed >= 0 ? failed : calls.length - 1]))

  if (!call) return undefined
  const args = executeToolCallArgs(call)

  return args.length ? `${call.tool} [${args.join(", ")}]` : call.tool
}

export function currentToolHasLoadedFiles(tool: SessionMessageAssistantTool) {
  if (tool.name !== "read" || tool.state.status !== "completed") return false
  const loaded = tool.state.metadata?.loaded

  return Array.isArray(loaded) && loaded.some(Predicate.isString)
}

export function readImagePath(input: ToolProps["input"]) {
  if (!Predicate.isString(input.path) || !/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(input.path)) return

  return input.path.replaceAll("\\", "/")
}

// Plain file reads render as one comma-separated row; images and loaded instructions keep their own rows.
export function currentToolGroupedRead(tool: SessionMessageAssistantTool) {
  return (
    tool.name === "read" &&
    tool.state.status !== "error" &&
    !readImagePath(currentToolInput(tool)) &&
    !currentToolHasLoadedFiles(tool)
  )
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

  return !files.every((file) => Predicate.hasProperty(file, "status") && file.status === "deleted")
}
