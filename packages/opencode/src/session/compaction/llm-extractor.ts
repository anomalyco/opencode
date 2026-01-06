import type { MessageV2 } from "../message-v2"
import type { CompactionSchema } from "./schema"

/**
 * LLM-based extraction for semantic sections that require understanding.
 * Uses a single structured prompt to extract all sections efficiently.
 */
export namespace LLMExtractor {
  /**
   * Default number of recent messages to include for context
   */
  const DEFAULT_RECENT_MESSAGES = 10

  /**
   * Build the extraction prompt combining condensed context and recent messages
   */
  export function buildPrompt(condensedContext: string, recentMessages: string): string {
    return `You are analyzing a coding session to create a continuation summary.

## Deterministic Context (Files, Tools, Errors)
${condensedContext}

## Recent Conversation
${recentMessages}

---

Extract the following information and respond with a JSON object:

{
  "session_intent": "What is the user trying to accomplish? Be specific about the goal.",
  "current_state": "What is the current state of the work? What has been completed, what is in progress?",
  "decisions": [
    { "decision": "Key decision that was made", "rationale": "Why this decision was made" }
  ],
  "pending_tasks": ["Task 1 that remains", "Task 2 that remains"],
  "key_context": "Critical technical details, constraints, or insights that must be preserved"
}

Respond ONLY with the JSON object. Be concise but comprehensive.`
  }

  /**
   * Convert messages to a text format suitable for LLM context
   */
  export function messagesToRecentContext(
    messages: MessageV2.WithParts[],
    limit: number = DEFAULT_RECENT_MESSAGES
  ): string {
    // Take only the last N messages
    const recentMessages = messages.slice(-limit)

    const lines: string[] = []

    for (const msg of recentMessages) {
      const role = msg.info.role.toUpperCase()
      const parts: string[] = []

      for (const part of msg.parts) {
        if (part.type === "text") {
          parts.push(part.text)
        } else if (part.type === "tool") {
          // Include a brief summary of tool usage
          if (part.state.status === "completed") {
            const outputPreview = part.state.output?.slice(0, 200) || ""
            parts.push(`[Tool: ${part.tool}] ${outputPreview}${part.state.output && part.state.output.length > 200 ? "..." : ""}`)
          } else if (part.state.status === "error") {
            parts.push(`[Tool: ${part.tool}] Error: ${part.state.error}`)
          } else {
            parts.push(`[Tool: ${part.tool}] (pending)`)
          }
        } else if (part.type === "reasoning") {
          // Skip reasoning parts to save tokens
        }
      }

      if (parts.length > 0) {
        lines.push(`${role}: ${parts.join("\n")}`)
      }
    }

    return lines.join("\n\n")
  }

  /**
   * Parse the LLM response to extract structured data
   */
  export function parseResponse(response: string): CompactionSchema.LLMExtractionOutput {
    const defaults: CompactionSchema.LLMExtractionOutput = {
      session_intent: "",
      current_state: "",
      decisions: [],
      pending_tasks: [],
      key_context: "",
    }

    try {
      // Try to extract JSON from the response
      let jsonStr = response

      // Handle markdown code fences
      const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1]
      }

      // Try to find JSON object in the response
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        jsonStr = jsonMatch[0]
      }

      const parsed = JSON.parse(jsonStr)

      return {
        session_intent: typeof parsed.session_intent === "string" ? parsed.session_intent : defaults.session_intent,
        current_state: typeof parsed.current_state === "string" ? parsed.current_state : defaults.current_state,
        decisions: Array.isArray(parsed.decisions)
          ? parsed.decisions.filter(
              (d: unknown) =>
                typeof d === "object" &&
                d !== null &&
                typeof (d as Record<string, unknown>).decision === "string"
            ).map((d: Record<string, string>) => ({
              decision: d.decision,
              rationale: d.rationale || "",
            }))
          : defaults.decisions,
        pending_tasks: Array.isArray(parsed.pending_tasks)
          ? parsed.pending_tasks.filter((t: unknown) => typeof t === "string")
          : defaults.pending_tasks,
        key_context: typeof parsed.key_context === "string" ? parsed.key_context : defaults.key_context,
      }
    } catch {
      // Return defaults if parsing fails
      return defaults
    }
  }

  /**
   * Extract agent context for preserving agent personality/role
   */
  export function extractAgentContext(
    agentInfo?: { name: string; systemPrompt?: string }
  ): CompactionSchema.AgentContext | undefined {
    if (!agentInfo) {
      return undefined
    }

    const constraints: string[] = []

    if (agentInfo.systemPrompt) {
      // Extract constraint patterns from system prompt
      const constraintPatterns = [
        /(?:must|should|always|never|only)\s+([^.]+)/gi,
        /(?:do not|don't|cannot|can't)\s+([^.]+)/gi,
      ]

      for (const pattern of constraintPatterns) {
        pattern.lastIndex = 0
        let match
        while ((match = pattern.exec(agentInfo.systemPrompt)) !== null) {
          constraints.push(match[0].trim())
        }
      }
    }

    return {
      agent_name: agentInfo.name,
      agent_role: agentInfo.systemPrompt?.slice(0, 200),
      constraints: constraints.slice(0, 5), // Limit to top 5 constraints
    }
  }

  /**
   * Schema for structured output extraction (used with generateObject)
   */
  export const LLMExtractionSchema = {
    type: "object" as const,
    properties: {
      session_intent: {
        type: "string" as const,
        description: "What is the user trying to accomplish?",
      },
      current_state: {
        type: "string" as const,
        description: "What is the current state of the work?",
      },
      decisions: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            decision: { type: "string" as const },
            rationale: { type: "string" as const },
          },
          required: ["decision", "rationale"],
        },
        description: "Key decisions made during the session",
      },
      pending_tasks: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Tasks that remain to be done",
      },
      key_context: {
        type: "string" as const,
        description: "Critical technical context to preserve",
      },
    },
    required: ["session_intent", "current_state", "decisions", "pending_tasks", "key_context"],
  }
}
