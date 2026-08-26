import type { JsonValue, SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode-ai/client/promise"
import type { SessionDocument } from "../document"
import { CURRENT_SESSION_ID, STORY_MODEL, STORY_TIME, thinkingDocument } from "./current-session-fixtures"

export function storyTool(
  id: string,
  name: string,
  status: "streaming" | "running" | "completed" | "error",
  input: Record<string, JsonValue>,
  options: { metadata?: Record<string, JsonValue>; output?: string; error?: string; raw?: string } = {},
): SessionMessageAssistantTool {
  const state =
    status === "streaming"
      ? { status, input: options.raw ?? JSON.stringify(input) }
      : status === "running"
        ? { status, input, metadata: { ...options.metadata, ...(options.output ? { output: options.output } : {}) } }
        : status === "error"
          ? {
              status,
              input,
              error: { type: "ToolExecutionError", message: options.error ?? `${name} failed visibly` },
              metadata: options.metadata,
            }
          : {
              status,
              input,
              content: [{ type: "text" as const, text: options.output ?? "Complete" }] as [
                { type: "text"; text: string },
              ],
              metadata: options.metadata,
            }
  return {
    type: "tool",
    id,
    name,
    state,
    time: {
      created: STORY_TIME,
      ...(status === "streaming" ? {} : { ran: STORY_TIME + 100 }),
      ...(status === "completed" || status === "error" ? { completed: STORY_TIME + 200 } : {}),
    },
  }
}

export function storyDocument(content: SessionMessageAssistant["content"], busy = false): SessionDocument {
  return {
    sessionID: CURRENT_SESSION_ID,
    messages: [
      ...thinkingDocument.messages,
      {
        id: "msg_tool_projection_assistant",
        type: "assistant",
        agent: "build",
        model: STORY_MODEL,
        content,
        time: { created: STORY_TIME, ...(busy ? {} : { completed: STORY_TIME + 300 }) },
      },
    ],
    status: { type: busy ? "busy" : "idle" },
    diffs: [],
  }
}

export function storyPatchFile(file: string, status: "modified" | "added" = "modified") {
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
