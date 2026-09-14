import { resolveTemplate } from "@solid-primitives/i18n"
import en from "../i18n/en"

import type { FormField, FormValue } from "@opencode/client"

type Translate = (key: keyof typeof en, params?: Record<string, string | number | boolean>) => string
const translate: Translate = (key, params) => resolveTemplate(en[key], params)

export type FormAnswerField = Exclude<FormField, { type: "external" }>

export type FormRow = {
  value: string | boolean
  label: string
  description?: string
}

export function isFormAnswerField(field: FormField): field is FormAnswerField {
  return field.type !== "external"
}

export function formLabel(field: FormField) {
  return field.title ?? (field.type === "external" ? field.url : field.key)
}

export function formInitialValues(fields: ReadonlyArray<FormField>) {
  return {
    answers: Object.fromEntries(
      fields.flatMap((field) =>
        isFormAnswerField(field) && field.default !== undefined ? [[field.key, field.default]] : [],
      ),
    ) as Record<string, FormValue | undefined>,
    custom: Object.fromEntries(
      fields.flatMap((field) => {
        if (field.type !== "string" || !field.options || !field.custom || typeof field.default !== "string") return []
        if (field.options.some((option) => option.value === field.default)) return []
        return [[field.key, field.default]]
      }),
    ) as Record<string, string>,
  }
}

export function formTextual(field: FormField | undefined) {
  if (!field) return false
  return field.type === "number" || field.type === "integer" || (field.type === "string" && !field.options)
}

export function formCustom(field: FormField | undefined) {
  if (!field) return false
  if (field.type === "string" && field.options) return field.custom === true
  return field.type === "multiselect" && field.custom === true
}

export function formRows(field: FormField | undefined, t: Translate = translate): FormRow[] {
  if (!field) return []
  if (field.type === "boolean")
    return [
      { value: true, label: t("tui.form.yes") },
      { value: false, label: t("tui.form.no") },
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
  const rows = formRows(field)
  const index = rows.findIndex((row) => row.value === value)
  if (index !== -1) return index
  if (typeof value === "string" && formCustom(field)) return rows.length
  return 0
}

export function formValidateValue(
  field: FormAnswerField,
  value: FormValue | undefined,
  t: Translate = translate,
): string | undefined {
  if (value === undefined) return field.required ? t("tui.form.error.required") : undefined
  if (field.required && (value === "" || (Array.isArray(value) && value.length === 0)))
    return field.type === "multiselect" ? t("tui.form.error.one") : t("tui.form.error.required")
  if (field.type === "string") {
    if (typeof value !== "string") return t("tui.form.error.text")
    if (field.minLength !== undefined && value.length < field.minLength)
      return t("tui.form.error.minLength", { value: field.minLength })
    if (field.maxLength !== undefined && value.length > field.maxLength)
      return t("tui.form.error.maxLength", { value: field.maxLength })
    if (field.pattern !== undefined) {
      try {
        if (!new RegExp(field.pattern).test(value)) return t("tui.form.error.pattern", { value: field.pattern })
      } catch {
        return t("tui.form.error.invalidPattern", { value: field.pattern })
      }
    }
    if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return t("tui.form.error.email")
    if (field.format === "uri" && !validURL(value)) return t("tui.form.error.url")
    if (field.format === "date" && !validDate(value)) return t("tui.form.error.date")
    if (field.format === "date-time" && Number.isNaN(new Date(value).getTime())) return t("tui.form.error.dateTime")
    if (field.options && !field.custom && !field.options.some((option) => option.value === value))
      return t("tui.form.error.option")
    return
  }
  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return t("tui.form.error.number")
    if (field.type === "integer" && !Number.isInteger(value)) return t("tui.form.error.integer")
    if (typeof field.minimum === "number" && value < field.minimum)
      return t("tui.form.error.minimum", { value: field.minimum })
    if (typeof field.maximum === "number" && value > field.maximum)
      return t("tui.form.error.maximum", { value: field.maximum })
    return
  }
  if (field.type === "boolean") return typeof value === "boolean" ? undefined : t("tui.form.error.boolean")
  if (!Array.isArray(value)) return t("tui.form.error.selections")
  if (field.minItems !== undefined && value.length < field.minItems)
    return t("tui.form.error.minItems", { value: field.minItems })
  if (field.maxItems !== undefined && value.length > field.maxItems)
    return t("tui.form.error.maxItems", { value: field.maxItems })
  if (!field.custom && value.some((item) => !field.options.some((option) => option.value === item)))
    return t("tui.form.error.available")
}

export function formDisplayValue(
  field: FormAnswerField,
  value: FormValue | undefined,
  emptyMultiselect: string,
  t: Translate = translate,
) {
  if (value === undefined) return ""
  const label = (item: string | number | boolean) =>
    formRows(field, t).find((row) => row.value === item)?.label ?? String(item)
  if (Array.isArray(value)) return value.length === 0 ? emptyMultiselect : value.map(label).join(", ")
  return label(value)
}

export function formToggleMultiselect(value: FormValue | undefined, item: string) {
  const values = Array.isArray(value) ? value : []
  const index = values.indexOf(item)
  return index === -1 ? [...values, item] : values.toSpliced(index, 1)
}

export function formSetMultiselectCustom(value: FormValue | undefined, previous: string | undefined, next: string) {
  const values = Array.isArray(value) ? value : []
  const index = previous ? values.indexOf(previous) : -1
  const current = index === -1 ? [...values] : values.toSpliced(index, 1)
  return next && !current.includes(next) ? [...current, next] : current
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
