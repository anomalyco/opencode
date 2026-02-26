import type { Message, Part, QuestionRequest } from "@opencode-ai/sdk/v2"

export type SessionMode = "build" | "plan"
export type SessionQuestionKind = "generic" | "plan_enter" | "plan_exit"

export function resolveSessionMode(messages: Message[] | undefined): SessionMode {
  if (!messages?.length) return "build"
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "user") continue
    if (msg.agent === "plan") return "plan"
    if (msg.agent === "build") return "build"
  }
  return "build"
}

export function resolveQuestionKind(input: {
  request: QuestionRequest | undefined
  parts: Part[] | undefined
}): SessionQuestionKind {
  const request = input.request
  if (!request?.tool) return "generic"
  const part = input.parts?.find((part) => part.type === "tool" && part.callID === request.tool?.callID)
  if (!part || part.type !== "tool") return "generic"
  if (part.tool === "plan_enter") return "plan_enter"
  if (part.tool === "plan_exit") return "plan_exit"
  return "generic"
}
