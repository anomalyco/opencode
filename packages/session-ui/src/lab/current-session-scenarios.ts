import type { JsonValue, SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, LAB_MODEL, LAB_TIME, thinkingDocument } from "./current-session-fixtures"

type LabToolStatus = "streaming" | "running" | "completed" | "error"

type LabToolOptions = { metadata?: Record<string, JsonValue>; output?: string; error?: string; raw?: string }

export function labTool(
  id: string,
  name: string,
  status: LabToolStatus,
  input: Record<string, JsonValue>,
  options: LabToolOptions = {},
): SessionMessageAssistantTool {
  return { type: "tool", id, name, state: toolState(name, status, input, options), time: toolTime(status) }
}

export function labDocument(content: SessionMessageAssistant["content"], busy = false): SessionDocument {
  const time: SessionMessageAssistant["time"] = { created: LAB_TIME }

  if (!busy) time.completed = LAB_TIME + 300

  return {
    sessionID: CURRENT_SESSION_ID,
    messages: [
      ...thinkingDocument.messages,
      {
        id: "msg_tool_projection_assistant",
        type: "assistant",
        agent: "build",
        model: LAB_MODEL,
        content,
        time,
      },
    ],
    status: { type: busy ? "busy" : "idle" },
    diffs: [],
  }
}

function toolState(
  name: string,
  status: LabToolStatus,
  input: Record<string, JsonValue>,
  options: LabToolOptions,
): SessionMessageAssistantTool["state"] {
  if (status === "streaming") return { status, input: options.raw ?? JSON.stringify(input) }

  if (status === "running") {
    const metadata = { ...options.metadata }

    if (options.output) metadata.output = options.output

    return { status, input, metadata }
  }

  if (status === "error") {
    return {
      status,
      input,
      error: { type: "ToolExecutionError", message: options.error ?? `${name} failed visibly` },
      metadata: options.metadata,
    }
  }

  return { status, input, content: [{ type: "text", text: options.output ?? "Complete" }], metadata: options.metadata }
}

function toolTime(status: LabToolStatus) {
  const time: SessionMessageAssistantTool["time"] = { created: LAB_TIME }

  if (status !== "streaming") time.ran = LAB_TIME + 100

  if (status === "completed" || status === "error") time.completed = LAB_TIME + 200

  return time
}

export function labPatchFile(file: string, status: "modified" | "added" = "modified") {
  return {
    file,
    status,
    patch:
      status === "added"
        ? "@@ -0,0 +1 @@\n+export const after = true"
        : "@@ -1 +1 @@\n-export const before = true\n+export const after = true",
    additions: 1,
    deletions: status === "added" ? 0 : 1,
  }
}
