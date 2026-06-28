import type { SessionV1 } from "@opencode-ai/core/v1/session"

export type Kind = "user_text" | "assistant_text" | "tool_input" | "tool_error" | "reasoning" | "tool_output"

export const ALL_KINDS: ReadonlyArray<Kind> = [
  "user_text",
  "assistant_text",
  "tool_input",
  "tool_error",
  "reasoning",
  "tool_output",
]

export const DEFAULT_KINDS: ReadonlyArray<Kind> = ["user_text", "assistant_text", "tool_input", "tool_error"]

export type Extracted = { kind: Kind; body: string; tool_name: string | null }

/**
 * Flatten one message part into a searchable text body tagged by kind, or null
 * if the part type/state isn't indexable or its kind is disabled.
 */
export function extract(
  part: SessionV1.Part,
  messageRole: "user" | "assistant",
  enabledKinds: ReadonlySet<Kind>,
): Extracted | null {
  switch (part.type) {
    case "text": {
      const kind: Kind = messageRole === "user" ? "user_text" : "assistant_text"
      if (!enabledKinds.has(kind)) return null
      if (!part.text) return null
      return { kind, body: part.text, tool_name: null }
    }
    case "reasoning": {
      if (!enabledKinds.has("reasoning")) return null
      if (!part.text) return null
      return { kind: "reasoning", body: part.text, tool_name: null }
    }
    case "tool": {
      const state = part.state
      if (state.status === "pending" || state.status === "running") return null

      if (state.status === "error" && enabledKinds.has("tool_error")) {
        return {
          kind: "tool_error",
          body: `${part.tool} ${JSON.stringify(state.input ?? {})} ${state.error ?? ""}`,
          tool_name: part.tool,
        }
      }
      if (state.status === "completed" && enabledKinds.has("tool_output")) {
        return {
          kind: "tool_output",
          body: `${part.tool} ${JSON.stringify(state.input ?? {})} ${JSON.stringify(state.output ?? "")}`,
          tool_name: part.tool,
        }
      }
      if (enabledKinds.has("tool_input")) {
        return {
          kind: "tool_input",
          body: `${part.tool} ${JSON.stringify(state.input ?? {})}`,
          tool_name: part.tool,
        }
      }
      return null
    }
    default:
      return null
  }
}

/** Render a part to human-readable text for the `around` context view. */
export function renderPart(part: SessionV1.Part): { type: string; tool_name: string | null; text: string } {
  switch (part.type) {
    case "text":
    case "reasoning":
      return { type: part.type, tool_name: null, text: part.text ?? "" }
    case "tool": {
      const state = part.state
      const input = "input" in state ? state.input : {}
      const tail =
        state.status === "error"
          ? `error: ${state.error ?? ""}`
          : state.status === "completed"
            ? `output: ${JSON.stringify(state.output ?? "")}`
            : `status: ${state.status}`
      return {
        type: "tool",
        tool_name: part.tool ?? null,
        text: `tool: ${part.tool ?? ""}\ninput: ${JSON.stringify(input ?? {})}\n${tail}`,
      }
    }
    default:
      return { type: part.type, tool_name: null, text: `[${part.type}]` }
  }
}
