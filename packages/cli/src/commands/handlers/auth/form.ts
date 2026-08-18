import { confirm, log, multiselect, password, select, text, type Option } from "@clack/prompts"
import { Effect } from "effect"
import type { FormAnswer, FormField, FormFields } from "@opencode-ai/client"
import { openUrl, prompt, requireInteractive } from "../../../ui/prompt"

const skip = Symbol("skip")
const custom = Symbol("custom")

export const answerForm = Effect.fn("cli.auth.form")(function* (fields: FormFields | undefined) {
  if (!fields) return undefined
  yield* requireInteractive("Authentication form input requires an interactive terminal")
  const answer: FormAnswer = {}
  for (const field of fields) {
    if (!active(field, answer)) continue
    const value = yield* answerField(field)
    if (value !== undefined) answer[field.key] = value
  }
  return answer
})

export const secret = Effect.fn("cli.auth.secret")(function* (message: string) {
  yield* requireInteractive("API key input requires an interactive terminal")
  return yield* prompt<string>(() => password({ message, validate: (value) => (!value ? "Required" : undefined) }))
})

const answerField = Effect.fn("cli.auth.form.field")(function* (field: FormField) {
  const message = field.title ?? field.key
  if (field.description) log.info(field.description)
  if (field.type === "external") {
    log.info(field.url)
    yield* openUrl(field.url)
    const acknowledged = yield* prompt<boolean>(() =>
      confirm({ message: message || "Continue after completing this step?", initialValue: true }),
    )
    if (!acknowledged) return yield* Effect.fail(new Error(`${message || "External step"} is required`))
    return true
  }
  if (field.type === "boolean") {
    if (field.required) return yield* prompt<boolean>(() => confirm({ message, initialValue: field.default ?? true }))
    const options: Array<Option<boolean | typeof skip>> = [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
      { value: skip, label: "Skip" },
    ]
    const value = yield* prompt<boolean | typeof skip>(() =>
      select<boolean | typeof skip>({
        message,
        options,
        initialValue: field.default ?? skip,
      }),
    )
    if (value === skip) return undefined
    return value
  }
  if (field.type === "multiselect") {
    const options: Array<Option<string | typeof custom>> = field.options.map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.description,
    }))
    if (field.custom) options.push({ value: custom, label: "Type another value" })
    const values = yield* prompt<Array<string | typeof custom>>(() =>
      multiselect<string | typeof custom>({
        message,
        options,
        initialValues: field.default,
        required: field.required || (field.minItems ?? 0) > 0,
      }),
    )
    const selected = values.filter((value): value is string => value !== custom)
    if (values.includes(custom)) {
      selected.push(yield* prompt<string>(() => text({ message: "Enter value", validate: required })))
    }
    if (field.minItems !== undefined && selected.length < field.minItems) {
      return yield* Effect.fail(new Error(`Select at least ${field.minItems}`))
    }
    if (field.maxItems !== undefined && selected.length > field.maxItems) {
      return yield* Effect.fail(new Error(`Select at most ${field.maxItems}`))
    }
    return selected
  }
  if (field.type === "string" && field.options) {
    const options: Array<Option<string | typeof custom | typeof skip>> = field.options.map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.description,
    }))
    if (field.custom) options.push({ value: custom, label: "Type your own answer" })
    if (!field.required) options.push({ value: skip, label: "Skip" })
    const value = yield* prompt<string | typeof custom | typeof skip>(() =>
      select<string | typeof custom | typeof skip>({ message, options, initialValue: field.default }),
    )
    if (value === skip) return undefined
    if (value !== custom) return value
  }
  const value = yield* prompt<string>(() =>
    text({
      message,
      placeholder: field.type === "string" ? field.placeholder : undefined,
      initialValue: field.default === undefined ? undefined : String(field.default),
      validate: (input) => validateText(field, input),
    }),
  )
  if (!value && !field.required) return undefined
  if (field.type === "string") return value
  return Number(value)
})

function active(field: FormField, answer: FormAnswer) {
  if (field.type === "external" || !field.when) return true
  return field.when.every((condition) => {
    const value = answer[condition.key]
    if (value === undefined) return false
    const matches = Array.isArray(value) ? value.includes(String(condition.value)) : value === condition.value
    return condition.op === "eq" ? matches : !matches
  })
}

function required(value: string | undefined) {
  return value ? undefined : "Required"
}

function validateText(field: Exclude<FormField, { type: "boolean" | "external" | "multiselect" }>, value?: string) {
  if (!value) return field.required ? "Required" : undefined
  if (field.type === "number" || field.type === "integer") {
    const number = Number(value)
    if (!Number.isFinite(number)) return "Expected a number"
    if (field.type === "integer" && !Number.isInteger(number)) return "Expected an integer"
    if (typeof field.minimum === "number" && number < field.minimum) return `Must be at least ${field.minimum}`
    if (typeof field.maximum === "number" && number > field.maximum) return `Must be at most ${field.maximum}`
    return undefined
  }
  if (field.minLength !== undefined && value.length < field.minLength)
    return `Must be at least ${field.minLength} characters`
  if (field.maxLength !== undefined && value.length > field.maxLength)
    return `Must be at most ${field.maxLength} characters`
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(value)) return "Invalid format"
    } catch {
      return "Invalid format"
    }
  }
  if (field.format === "uri" && !URL.canParse(value)) return "Expected a URL"
  if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Expected an email address"
  if (field.format === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Expected a date"
    const date = new Date(`${value}T00:00:00.000Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "Expected a date"
  }
  if (field.format === "date-time" && Number.isNaN(Date.parse(value))) return "Expected a date and time"
  return undefined
}
