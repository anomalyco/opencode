import type { FormAnswer, FormField, FormInfo, FormValue } from "@opencode-ai/client/promise"
import type { FormReply, MiniFormRequest } from "./types"

type AnswerField = Exclude<FormField, { type: "external" }>

export type FormBodyState = {
  formID: string
  field: number
  answers: Record<string, FormValue | undefined>
  custom: Record<string, string>
  selected: number
  editing: boolean
  externalReady: Record<string, boolean>
  submitting: boolean
  error: string
}

export type FormRow = {
  value: string | boolean
  label: string
  description?: string
}

export function createFormBodyState(form: FormInfo): FormBodyState {
  const answers = Object.fromEntries(
    form.fields.flatMap((field) =>
      field.type !== "external" && field.default !== undefined ? [[field.key, field.default]] : [],
    ),
  )
  const custom = Object.fromEntries(
    form.fields.flatMap((field) => {
      if (field.type !== "string" || !field.options || !field.custom || typeof field.default !== "string") return []
      if (field.options.some((option) => option.value === field.default)) return []
      return [[field.key, field.default]]
    }),
  )
  return {
    formID: form.id,
    field: 0,
    answers,
    custom,
    selected: formSelected(form.fields[0], answers[form.fields[0]?.key ?? ""]),
    editing: formTextual(form.fields[0]),
    externalReady: {},
    submitting: false,
    error: "",
  }
}

export function formSync(state: FormBodyState, form: FormInfo): FormBodyState {
  return state.formID === form.id ? state : createFormBodyState(form)
}

export function formUnsupported(form: FormInfo): string | undefined {
  if (!Array.isArray(form.fields) || form.fields.length === 0) return "This form has no supported fields."
  for (const field of form.fields as ReadonlyArray<FormField | Record<string, unknown>>) {
    if (!field || typeof field !== "object" || typeof field.type !== "string") return "This form uses an unknown field."
    if (!("key" in field) || typeof field.key !== "string") return "This form uses an invalid field."
    if ("when" in field && Array.isArray(field.when) && field.when.length > 0)
      return "Conditional forms are not supported in Mini yet."
    if (field.type === "string" && "pattern" in field && field.pattern !== undefined)
      return "Pattern-constrained forms are not supported in Mini yet."
    if (!["string", "number", "integer", "boolean", "multiselect", "external"].includes(field.type))
      return `Field type ${field.type} is not supported in Mini yet.`
  }
}

export function formLabel(field: FormField) {
  return field.title ?? (field.type === "external" ? field.url : field.key)
}

export function formCurrent(form: FormInfo, state: FormBodyState) {
  return form.fields[state.field]
}

export function formConfirm(form: FormInfo, state: FormBodyState) {
  return state.field >= form.fields.length
}

export function formSingle(form: FormInfo) {
  if (form.fields.length !== 1) return false
  const field = form.fields[0]
  return (
    field?.type === "boolean" ||
    field?.type === "number" ||
    field?.type === "integer" ||
    field?.type === "external" ||
    field?.type === "string"
  )
}

export function formTextual(field: FormField | undefined) {
  if (!field) return false
  return field.type === "number" || field.type === "integer" || (field.type === "string" && !field.options)
}

export function formPlaceholder(field: FormField | undefined) {
  if (field?.type === "string") return field.placeholder ?? "Type your answer"
  return "Enter a number"
}

export function formCustom(field: FormField | undefined) {
  if (!field) return false
  if (field.type === "string" && field.options) return field.custom === true
  return field.type === "multiselect" && field.custom === true
}

export function formRows(field: FormField | undefined): FormRow[] {
  if (!field) return []
  if (field.type === "boolean")
    return [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ]
  const options = field.type === "multiselect" ? field.options : field.type === "string" ? field.options : undefined
  if (!options) return []
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
  }))
}

export function formSelected(field: FormField | undefined, value: FormValue | undefined) {
  if (!field || value === undefined || Array.isArray(value)) return 0
  const index = formRows(field).findIndex((row) => row.value === value)
  if (index !== -1) return index
  if (typeof value === "string" && formCustom(field)) return formRows(field).length
  return 0
}

export function formMove(state: FormBodyState, form: FormInfo, direction: -1 | 1): FormBodyState {
  const field = formCurrent(form, state)
  const total = formRows(field).length + (formCustom(field) ? 1 : 0)
  if (total === 0) return state
  return { ...state, selected: (state.selected + direction + total) % total, error: "" }
}

export function formSetSelected(state: FormBodyState, selected: number): FormBodyState {
  return { ...state, selected, error: "" }
}

export function formSetEditing(state: FormBodyState, editing: boolean): FormBodyState {
  return { ...state, editing, error: "" }
}

export function formSetSubmitting(state: FormBodyState, submitting: boolean, error = ""): FormBodyState {
  return { ...state, submitting, error }
}

export function formSetError(state: FormBodyState, error: string): FormBodyState {
  return { ...state, error, submitting: false }
}

export function formSetExternalReady(state: FormBodyState, key: string): FormBodyState {
  return { ...state, externalReady: { ...state.externalReady, [key]: true }, error: "" }
}

export function formInput(state: FormBodyState, field: FormField | undefined) {
  if (!field || field.type === "external") return ""
  return state.custom[field.key] ?? formDisplay(field, state.answers[field.key])
}

export function formSetDraft(state: FormBodyState, field: FormField | undefined, value: string): FormBodyState {
  if (!field || field.type === "external") return state
  return { ...state, custom: { ...state.custom, [field.key]: value } }
}

export function formValidateValue(field: AnswerField, value: FormValue | undefined): string | undefined {
  if (value === undefined) return field.required ? "Answer required" : undefined
  if (field.required && (value === "" || (Array.isArray(value) && value.length === 0)))
    return field.type === "multiselect" ? "Select at least one option" : "Answer required"
  if (field.type === "string") {
    if (typeof value !== "string") return "Expected text"
    if (field.minLength !== undefined && value.length < field.minLength)
      return `Must be at least ${field.minLength} characters`
    if (field.maxLength !== undefined && value.length > field.maxLength)
      return `Must be at most ${field.maxLength} characters`
    if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Expected an email address"
    if (field.format === "uri" && !validURL(value)) return "Expected a URL"
    if (field.format === "date" && !validDate(value)) return "Expected a date (YYYY-MM-DD)"
    if (field.format === "date-time" && Number.isNaN(new Date(value).getTime())) return "Expected a date and time"
    if (field.options && !field.custom && !field.options.some((option) => option.value === value))
      return "Select an available option"
    return
  }
  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Expected a number"
    if (field.type === "integer" && !Number.isInteger(value)) return "Expected an integer"
    if (typeof field.minimum === "number" && value < field.minimum) return `Must be at least ${field.minimum}`
    if (typeof field.maximum === "number" && value > field.maximum) return `Must be at most ${field.maximum}`
    return
  }
  if (field.type === "boolean") return typeof value === "boolean" ? undefined : "Expected yes or no"
  if (!Array.isArray(value)) return "Expected selections"
  if (field.required && value.length === 0) return "Select at least one option"
  if (field.minItems !== undefined && value.length < field.minItems) return `Select at least ${field.minItems}`
  if (field.maxItems !== undefined && value.length > field.maxItems) return `Select at most ${field.maxItems}`
  if (!field.custom && value.some((item) => !field.options.some((option) => option.value === item)))
    return "Select only available options"
}

export function formValidate(form: FormInfo, state: FormBodyState): string | undefined {
  const unsupported = formUnsupported(form)
  if (unsupported) return unsupported
  for (const field of form.fields) {
    if (field.type === "external") {
      if (state.answers[field.key] !== true) return `Acknowledge ${formLabel(field)}`
      continue
    }
    const invalid = formValidateValue(field, state.answers[field.key])
    if (invalid) return `${formLabel(field)}: ${invalid}`
  }
}

export function formAnswer(form: FormInfo, state: FormBodyState): FormAnswer | undefined {
  if (formValidate(form, state)) return
  return Object.fromEntries(
    form.fields.flatMap((field) => {
      const value = state.answers[field.key]
      return value === undefined ? [] : [[field.key, value] as const]
    }),
  )
}

export function formReply(form: MiniFormRequest, state: FormBodyState): FormReply | undefined {
  const answer = formAnswer(form, state)
  if (!answer) return
  return { sessionID: form.sessionID, formID: form.id, answer, location: form.location }
}

export function formSetField(state: FormBodyState, form: FormInfo, index: number): FormBodyState {
  const bounded = Math.max(0, Math.min(form.fields.length, index))
  const field = form.fields[bounded]
  return {
    ...state,
    field: bounded,
    selected: formSelected(field, field ? state.answers[field.key] : undefined),
    editing: formTextual(field),
    error: "",
  }
}

export function formPick(state: FormBodyState, form: FormInfo): FormBodyState {
  const field = formCurrent(form, state)
  if (!field || field.type === "external" || formTextual(field)) return state
  const rows = formRows(field)
  if (state.selected === rows.length && formCustom(field)) return formSetEditing(state, true)
  const row = rows[state.selected]
  if (!row) return state
  if (field.type === "multiselect") {
    const answer = state.answers[field.key]
    const values = Array.isArray(answer) ? [...answer] : []
    const value = String(row.value)
    const index = values.indexOf(value)
    if (index === -1) values.push(value)
    if (index !== -1) values.splice(index, 1)
    return { ...state, answers: { ...state.answers, [field.key]: values }, error: "" }
  }
  const next = {
    ...state,
    answers: { ...state.answers, [field.key]: row.value },
    error: "",
  }
  return formSetField(next, form, formSingle(form) ? state.field : state.field + 1)
}

export function formCommitInput(state: FormBodyState, form: FormInfo, text: string): FormBodyState {
  const field = formCurrent(form, state)
  if (!field || field.type === "external" || field.type === "boolean") return state
  const input = text.trim()
  const value = !input ? undefined : field.type === "number" || field.type === "integer" ? Number(input) : input
  if (field.type === "multiselect") {
    const answer = state.answers[field.key]
    const values = Array.isArray(answer) ? [...answer] : []
    const previous = state.custom[field.key]
    if (previous) {
      const index = values.indexOf(previous)
      if (index !== -1) values.splice(index, 1)
    }
    if (input && !values.includes(input)) values.push(input)
    const invalid = formValidateValue(field, values)
    if (invalid) return formSetError(state, invalid)
    return {
      ...state,
      answers: { ...state.answers, [field.key]: values },
      custom: { ...state.custom, [field.key]: input },
      editing: false,
      error: "",
    }
  }
  const invalid = formValidateValue(field, value)
  if (invalid) return formSetError(state, invalid)
  return {
    ...state,
    answers: { ...state.answers, [field.key]: value },
    custom: { ...state.custom, [field.key]: typeof value === "string" ? value : input },
    editing: false,
    error: "",
  }
}

export function formAcknowledge(state: FormBodyState, form: FormInfo): FormBodyState {
  const field = formCurrent(form, state)
  if (field?.type !== "external" || !state.externalReady[field.key]) return state
  const next = {
    ...state,
    answers: { ...state.answers, [field.key]: true },
    error: "",
  }
  return formSetField(next, form, formSingle(form) ? state.field : state.field + 1)
}

export function formDisplay(field: AnswerField, value: FormValue | undefined) {
  if (value === undefined) return ""
  const label = (item: string | number | boolean) =>
    formRows(field).find((row) => row.value === item)?.label ?? String(item)
  return Array.isArray(value) ? value.map(label).join(", ") : label(value)
}

export function formErrorMessage(error: unknown) {
  if (typeof error === "string" && error.trim()) return error
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message")
    if (typeof message === "string" && message.trim()) return message
    const tag = Reflect.get(error, "_tag")
    if (typeof tag === "string" && tag.trim()) return tag
  }
  return "Form request failed"
}

function validURL(value: string) {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
