import type { FormAnswer, FormField, FormInfo, FormValue } from "@opencode-ai/client/promise"
import {
  formCustom,
  formDisplayValue,
  formInitialValues,
  formLabel,
  formRows,
  formSelected,
  formSetMultiselectCustom,
  formTextual,
  formToggleMultiselect,
  formValidateValue,
} from "../util/form"
import type { FormAnswerField } from "../util/form"
import type { FormReply, MiniFormRequest } from "./types"

export { formCustom, formLabel, formRows, formSelected, formTextual, formValidateValue }

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

export function createFormBodyState(form: FormInfo): FormBodyState {
  const initial = formInitialValues(form.fields)
  return {
    formID: form.id,
    field: 0,
    answers: initial.answers,
    custom: initial.custom,
    selected: formSelected(form.fields[0], initial.answers[form.fields[0]?.key ?? ""]),
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

export function formPlaceholder(field: FormField | undefined) {
  if (field?.type === "string") return field.placeholder ?? "Type your answer"
  return "Enter a number"
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
    return {
      ...state,
      answers: { ...state.answers, [field.key]: formToggleMultiselect(state.answers[field.key], String(row.value)) },
      error: "",
    }
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
    const values = formSetMultiselectCustom(state.answers[field.key], state.custom[field.key], input)
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

export function formDisplay(field: FormAnswerField, value: FormValue | undefined) {
  return formDisplayValue(field, value, "")
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
