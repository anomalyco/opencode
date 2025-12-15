import type { Question } from "@/question"
import type { Answer } from "./types"

export function formatAnswerPreview(item: Question.QuestionItem, answer?: Answer): string {
  if (!answer || answer.value === undefined || answer.value === null) {
    return "(not answered)"
  }

  if (item.type === "confirm") {
    return answer.value ? "Yes" : "No"
  }

  if (item.type === "multi-select" && Array.isArray(answer.value)) {
    if (answer.value.length === 0) return "(none selected)"
    const labels = answer.value
      .map((v) => item.options?.find((o) => o.value === v)?.label ?? v)
      .slice(0, 2)
      .join(", ")
    if (answer.value.length > 2) {
      return `${labels} +${answer.value.length - 2} more`
    }
    return labels
  }

  if (item.type === "select" && typeof answer.value === "string") {
    const option = item.options?.find((o) => o.value === answer.value)
    return option?.label ?? answer.value
  }

  if (typeof answer.value === "string") {
    return truncate(answer.value, 40)
  }

  return String(answer.value)
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + "..."
}
