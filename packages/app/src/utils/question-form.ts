import type { FormAnswer, FormFormInfo, FormUrlInfo } from "@opencode-ai/sdk/v2"

export type QuestionOption = {
  value: string
  label: string
  description?: string
}

export type QuestionField = FormFormInfo["fields"][number]

export type QuestionForm = FormFormInfo | FormUrlInfo

export type QuestionAnswer = string[]

export function isQuestionForm(value: unknown): value is QuestionForm {
  if (typeof value !== "object" || value === null) return false
  const form = value as { id?: unknown; sessionID?: unknown; mode?: unknown; fields?: unknown; url?: unknown }
  if (typeof form.id !== "string" || typeof form.sessionID !== "string") return false
  if (form.mode === "url") return typeof form.url === "string"
  if (form.mode !== "form") return false
  return Array.isArray(form.fields) && form.fields.every(isQuestionField)
}

function isQuestionField(value: unknown): value is QuestionField {
  if (typeof value !== "object" || value === null) return false
  const field = value as { type?: unknown }
  return ["string", "number", "integer", "boolean", "multiselect"].includes(String(field.type))
}

export function questionAnswer(fields: ReadonlyArray<QuestionField>, answers: ReadonlyArray<QuestionAnswer>): FormAnswer {
  const entries = fields.flatMap((field, index): ReadonlyArray<readonly [string, FormAnswer[string]]> => {
    const answer = answers[index] ?? []
    if (answer.length === 0) {
      if (field.default === undefined) return []
      if (field.type === "multiselect") return [[field.key, [...field.default]]]
      return [[field.key, field.default]]
    }
    if (field.type === "multiselect") return [[field.key, answer]]
    if (field.type === "boolean") return [[field.key, answer[0] === "true"]]
    if (field.type === "number" || field.type === "integer") return [[field.key, Number(answer[0])]]
    return [[field.key, answer[0] ?? ""]]
  })
  return Object.fromEntries(entries)
}

export function questionOptions(field: QuestionField | undefined): QuestionOption[] {
  if (!field) return []
  if (field.type === "boolean")
    return [
      { value: "false", label: "No" },
      { value: "true", label: "Yes" },
    ]
  if (field.type === "string") return field.options ?? []
  if (field.type === "multiselect") return field.options
  return []
}

export function questionAllowsCustom(field: QuestionField | undefined) {
  if (!field) return false
  if (field.type === "number" || field.type === "integer") return true
  if (field.type !== "string" && field.type !== "multiselect") return false
  return questionOptions(field).length === 0 || field.custom === true
}

export function questionLabel(field: QuestionField | undefined) {
  return field?.title ?? field?.description ?? field?.key ?? "Form"
}

export function questionMessage(form: QuestionForm) {
  const message = form.metadata?.message
  return typeof message === "string" && message !== form.title ? message : undefined
}
