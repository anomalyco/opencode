import type { FormAnswer, FormFormInfo } from "@opencode-ai/sdk/v2"

export type QuestionField = Extract<FormFormInfo["fields"][number], { type: "string" | "multiselect" }>
export type QuestionForm = Omit<FormFormInfo, "fields"> & { fields: QuestionField[] }
export type QuestionAnswer = string[]

export function isQuestionForm(value: unknown): value is QuestionForm {
  if (typeof value !== "object" || value === null) return false
  const form = value as { mode?: unknown; metadata?: unknown; fields?: unknown }
  if (form.mode !== "form") return false
  if (typeof form.metadata !== "object" || form.metadata === null) return false
  if ((form.metadata as { kind?: unknown }).kind !== "question") return false
  return Array.isArray(form.fields) && form.fields.every(isQuestionField)
}

export function questionAnswer(fields: QuestionField[], answers: QuestionAnswer[]): FormAnswer {
  const entries = fields.flatMap((field, index): Array<[string, string | string[]]> => {
    const answer = answers[index] ?? []
    if (answer.length === 0) return []
    if (field.type === "multiselect") return [[field.key, answer]]
    return [[field.key, answer[0] ?? ""]]
  })
  return Object.fromEntries(entries)
}

function isQuestionField(value: unknown): value is QuestionField {
  if (typeof value !== "object" || value === null) return false
  const field = value as { type?: unknown }
  return field.type === "string" || field.type === "multiselect"
}
