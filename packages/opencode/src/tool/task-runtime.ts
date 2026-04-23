import z from "zod"
import type { MessageV2 } from "../session/message-v2"

export const TaskAgentSelectorFields = {
  subagent_type: z.string().optional().describe("The type of specialized agent to use for this task"),
  agent: z.string().optional().describe("Alias for subagent_type accepted for compatibility with non-Claude models"),
  agent_type: z.string().optional().describe("Alias for subagent_type accepted for compatibility with non-Claude models"),
}

export const TaskAgentSelector = z
  .object(TaskAgentSelectorFields)
  .superRefine((value, ctx) => {
    if (resolveAgentType(value)) return

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subagent_type"],
      message: "Expected one of subagent_type, agent, or agent_type",
    })
  })

export type TaskAgentSelectorInput = z.infer<typeof TaskAgentSelector>

export function resolveAgentType(input: TaskAgentSelectorInput): string | undefined {
  const candidates = [input.subagent_type, input.agent, input.agent_type]
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue
    const normalized = candidate.trim()
    if (normalized.length > 0) return normalized
  }
  return undefined
}

export function extractTaskResultText(result: MessageV2.WithParts): string {
  return result.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .findLast((value) => value.trim().length > 0)
    ?.trim() ?? ""
}

function hasToolActivity(result: MessageV2.WithParts): boolean {
  return result.parts.some((part) => part.type === "tool")
}

export type TaskResultValidation =
  | {
      valid: true
      outputText: string
      retryable: false
      reason?: undefined
    }
  | {
      valid: false
      outputText: ""
      retryable: boolean
      reason: string
    }

export function validateTaskResult(result: MessageV2.WithParts): TaskResultValidation {
  const outputText = extractTaskResultText(result)
  if (outputText.length > 0) {
    return {
      valid: true,
      outputText,
      retryable: false,
    }
  }

  if (hasToolActivity(result)) {
    return {
      valid: false,
      outputText: "",
      retryable: false,
      reason: "Task subagent produced no text output after running tools; automatic retry is not safe.",
    }
  }

  return {
    valid: false,
    outputText: "",
    retryable: true,
    reason: "Task subagent produced no text output.",
  }
}
