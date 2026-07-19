import type { PermissionV2Request, QuestionV2Request } from "@opencode-ai/client/promise"
import type { FooterView } from "./types"

export function pickBlockerView(input: {
  permission?: PermissionV2Request
  question?: QuestionV2Request
}): FooterView {
  if (input.permission) return { type: "permission", request: input.permission }
  if (input.question) return { type: "question", request: input.question }
  return { type: "prompt" }
}

export function blockerStatus(view: FooterView) {
  if (view.type === "permission") return "awaiting permission"
  if (view.type === "question") return "awaiting answer"
  return ""
}
