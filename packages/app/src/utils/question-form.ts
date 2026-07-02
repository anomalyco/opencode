export type QuestionOption = {
  value: string
  label: string
  description?: string
}

export type QuestionField = {
  key: string
  title?: string
  description?: string
  type: "string" | "multiselect"
  options?: QuestionOption[]
  custom?: boolean
}

export type QuestionForm = {
  id: string
  sessionID: string
  mode: "form"
  metadata?: { [key: string]: unknown }
  fields: QuestionField[]
}

export type QuestionAnswer = string[]

export function isQuestionForm(value: unknown): value is QuestionForm {
  if (typeof value !== "object" || value === null) return false
  const form = value as { mode?: unknown; metadata?: unknown; fields?: unknown }
  if (form.mode !== "form") return false
  if (typeof form.metadata !== "object" || form.metadata === null) return false
  if ((form.metadata as { kind?: unknown }).kind !== "question") return false
  return Array.isArray(form.fields) && form.fields.every(isQuestionField)
}

function isQuestionField(value: unknown): value is QuestionField {
  if (typeof value !== "object" || value === null) return false
  const field = value as { type?: unknown }
  return field.type === "string" || field.type === "multiselect"
}

export function questionAnswer(fields: ReadonlyArray<QuestionField>, answers: ReadonlyArray<QuestionAnswer>) {
  const entries = fields.flatMap((field, index): ReadonlyArray<readonly [string, string | string[]]> => {
    const answer = answers[index] ?? []
    if (answer.length === 0) return []
    if (field.type === "multiselect") return [[field.key, answer]]
    return [[field.key, answer[0] ?? ""]]
  })
  return Object.fromEntries(entries)
}
