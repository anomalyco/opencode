import type { FormAnswer, FormField, FormValue } from "@opencode/client/promise"

/** How long opening the browser may take before the link is shown to open by hand; desktop IPC can hang. */
export const FORM_BROWSER_OPEN_TIMEOUT_MS = 5_000

export type ProviderFormBrowser =
  | { readonly status: "unopened" }
  /** `unlocked` keeps "I finished" enabled while the link opens again after an earlier open. */
  | { readonly status: "opening"; readonly attempt: number; readonly unlocked: boolean }
  | { readonly status: "opened" }
  /** The browser did not open, so the link shows for the user to open by hand. */
  | { readonly status: "failed" }

export type ProviderFormChoice =
  | { readonly mode: "none"; readonly customDraft: string }
  | { readonly mode: "preset"; readonly value: string; readonly customDraft: string }
  | { readonly mode: "custom"; readonly text: string }

/** The one field the form asks now; data that only one kind of field has lives in its variant. */
export type ProviderFormStep =
  | {
      readonly kind: "external"
      readonly index: number
      readonly field: Extract<FormField, { type: "external" }>
      readonly browser: ProviderFormBrowser
    }
  | {
      readonly kind: "multiselect"
      readonly index: number
      readonly field: Extract<FormField, { type: "multiselect" }>
      readonly picked: readonly string[]
      readonly customText: string
    }
  | {
      readonly kind: "choice"
      readonly index: number
      readonly field: Extract<FormField, { type: "boolean" | "string" }>
      readonly choice: ProviderFormChoice
      readonly error: "required" | undefined
    }
  | {
      readonly kind: "text"
      readonly index: number
      readonly field: Extract<FormField, { type: "string" | "number" | "integer" }>
      readonly text: string
      readonly error: "required" | "number" | undefined
    }

/**
 * A method's form, asked one visible field at a time like the TUI, so `when` conditions see every earlier answer.
 * Browser opens take attempt numbers from `issued`, so a result for an earlier open or step is stale.
 */
export type ProviderFormState =
  | {
      readonly status: "active"
      readonly fields: readonly FormField[]
      readonly answer: FormAnswer
      readonly issued: number
      readonly step: ProviderFormStep
    }
  | { readonly status: "completed"; readonly answer: FormAnswer }

export type ProviderActiveForm = Extract<ProviderFormState, { status: "active" }>

/** What the user does on the current step. */
export type ProviderFormInput =
  | { readonly type: "text.changed"; readonly value: string }
  | { readonly type: "choice.selected"; readonly value: string }
  | { readonly type: "custom.text.changed"; readonly value: string }
  | { readonly type: "custom.item.added" }
  | { readonly type: "option.toggled"; readonly value: string; readonly checked: boolean }
  | { readonly type: "external.open" }
  | { readonly type: "step.submitted" }
  | { readonly type: "step.skipped" }

export type ProviderFormEvent =
  | ProviderFormInput
  /** `opened` is false when the browser failed to open or did not answer in time. */
  | { readonly type: "external.opened"; readonly attempt: number; readonly opened: boolean }

export type ProviderFormEffect = {
  readonly type: "open.browser"
  readonly attempt: number
  readonly url: string
  readonly timeoutMs: number
}

export type ProviderFormTransition = {
  readonly state: ProviderFormState
  readonly effects: readonly ProviderFormEffect[]
}

/** The form's first visible field, or its answer when every field is hidden or inactive. */
export function createProviderFormState(fields: readonly FormField[] | undefined) {
  return advance(fields ?? [], 0, {}, 0)
}

export function transitionProviderForm(state: ProviderActiveForm, event: ProviderFormEvent): ProviderFormTransition {
  const step = state.step

  if (step.kind === "external") return external(state, step, event)

  if (step.kind === "multiselect") {
    if (event.type === "option.toggled") {
      if (event.checked === step.picked.includes(event.value)) return unchanged(state)

      const picked = event.checked ? [...step.picked, event.value] : step.picked.filter((item) => item !== event.value)

      return unchanged({ ...state, step: { ...step, picked } })
    }

    if (event.type === "custom.text.changed") {
      if (!step.field.custom || event.value === step.customText) return unchanged(state)

      return unchanged({ ...state, step: { ...step, customText: event.value } })
    }

    if (event.type === "custom.item.added") {
      const value = step.customText.trim()

      if (!step.field.custom || !value || step.picked.includes(value)) return unchanged(state)

      return unchanged({ ...state, step: { ...step, picked: [...step.picked, value], customText: "" } })
    }

    if (event.type !== "step.submitted" || multiselectIssue(step) !== undefined) return unchanged(state)

    return next(state, step.picked.length ? [...step.picked] : undefined)
  }

  if (step.kind === "choice") {
    if (event.type === "choice.selected") {
      const choice = select(step, event.value)

      return choice ? unchanged({ ...state, step: { ...step, choice, error: undefined } }) : unchanged(state)
    }

    if (event.type === "custom.text.changed") {
      if (step.choice.mode !== "custom" || event.value === step.choice.text) return unchanged(state)

      return unchanged({ ...state, step: { ...step, choice: { mode: "custom", text: event.value }, error: undefined } })
    }

    if (event.type === "step.skipped") return step.field.required ? unchanged(state) : next(state, undefined)

    if (event.type !== "step.submitted") return unchanged(state)
    const value = choiceValue(step)

    if (value === undefined && step.field.required) return unchanged({ ...state, step: { ...step, error: "required" } })

    return next(state, value)
  }

  if (event.type === "text.changed") {
    if (event.value === step.text && step.error === undefined) return unchanged(state)

    return unchanged({ ...state, step: { ...step, text: event.value, error: undefined } })
  }

  if (event.type !== "step.submitted") return unchanged(state)
  const text = step.text.trim()

  if (!text) return step.field.required ? unchanged({ ...state, step: { ...step, error: "required" } }) : next(state, undefined)

  if (step.field.type === "string") return next(state, text)
  const value = Number(text)

  if (!Number.isFinite(value) || (step.field.type === "integer" && !Number.isInteger(value)))
    return unchanged({ ...state, step: { ...step, error: "number" } })

  return next(state, value)
}

export function selectProviderFormView(state: ProviderActiveForm) {
  const step = state.step
  const field = step.field

  const base = {
    // Changes with every step, so each step mounts fresh inputs; never empty, so step 0 is not falsy.
    key: `${step.index}:${field.key}`,
    title: field.title ?? (field.type === "external" ? field.url : field.key),
    description: field.description,
  }

  if (step.kind === "external") {
    const browser = step.browser

    return {
      ...base,
      kind: step.kind,
      url: step.field.url,
      opening: browser.status === "opening",
      browserFailed: browser.status === "failed",
      // Also labels the link "Open link again".
      canFinish: canFinish(browser),
    }
  }

  if (step.kind === "multiselect") {
    const issue = multiselectIssue(step)

    return {
      ...base,
      kind: step.kind,
      field: step.field,
      picked: step.picked,
      customText: step.customText,
      issue,
      canContinue: issue === undefined,
    }
  }

  if (step.kind === "choice") {
    const choice = step.choice

    return {
      ...base,
      kind: step.kind,
      field: step.field,
      selected: choice.mode === "custom" ? "custom" : choice.mode === "preset" ? choice.value : undefined,
      custom: step.field.type === "string" && !!step.field.custom,
      placeholder: step.field.type === "string" ? step.field.placeholder : undefined,
      customText: choice.mode === "custom" ? choice.text : "",
      canContinue: choiceValue(step) !== undefined,
      canSkip: !step.field.required,
      error: step.error,
    }
  }

  return {
    ...base,
    kind: step.kind,
    numeric: step.field.type !== "string",
    placeholder: step.field.type === "string" ? step.field.placeholder : undefined,
    text: step.text,
    error: step.error,
  }
}

export type ProviderFormView = ReturnType<typeof selectProviderFormView>

// Whether a field applies given the answers so far; the TUI's rule.
function formFieldActive(field: FormField, answer: FormAnswer) {
  if (field.type === "external" || !field.when) return true

  return field.when.every((condition) => {
    const value = answer[condition.key]

    if (value === undefined) return false
    const hit = Array.isArray(value) ? value.includes(String(condition.value)) : value === condition.value

    return condition.op === "eq" ? hit : !hit
  })
}

function external(
  state: ProviderActiveForm,
  step: Extract<ProviderFormStep, { kind: "external" }>,
  event: ProviderFormEvent,
): ProviderFormTransition {
  const browser = step.browser

  if (event.type === "external.open") {
    if (browser.status === "opening") return unchanged(state)
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        step: {
          ...step,
          browser: {
            status: "opening",
            attempt,
            unlocked: browser.status === "opened" || browser.status === "failed",
          },
        },
      },
      effects: [{ type: "open.browser", attempt, url: step.field.url, timeoutMs: FORM_BROWSER_OPEN_TIMEOUT_MS }],
    }
  }

  if (event.type === "external.opened") {
    if (browser.status !== "opening" || browser.attempt !== event.attempt) return unchanged(state)

    return unchanged({ ...state, step: { ...step, browser: { status: event.opened ? "opened" : "failed" } } })
  }

  if (event.type !== "step.submitted" || !canFinish(browser)) return unchanged(state)

  return next(state, true)
}

// A failed open still lets the user finish: they open the link by hand.
function canFinish(browser: ProviderFormBrowser) {
  return browser.status !== "unopened" && (browser.status !== "opening" || browser.unlocked)
}

// Records the step's answer and moves to the next visible field that applies.
function next(state: ProviderActiveForm, value: FormValue | undefined) {
  const answer = value === undefined ? state.answer : { ...state.answer, [state.step.field.key]: value }

  return unchanged(advance(state.fields, state.step.index + 1, answer, state.issued))
}

// Hidden fields that apply take their default in order, so a later `when` sees them, as in the TUI.
function advance(fields: readonly FormField[], index: number, answer: FormAnswer, issued: number): ProviderFormState {
  const field = fields.at(index)

  if (!field) return { status: "completed", answer }

  if (!formFieldActive(field, answer)) return advance(fields, index + 1, answer, issued)

  if (field.type !== "external" && field.hidden)
    return advance(
      fields,
      index + 1,
      field.default === undefined ? answer : { ...answer, [field.key]: field.default },
      issued,
    )

  return { status: "active", fields, answer, issued, step: initial(field, index) }
}

// Prefills a step from its field's default; the value enters the answer only once the user confirms it.
function initial(field: FormField, index: number): ProviderFormStep {
  if (field.type === "external") return { kind: "external", index, field, browser: { status: "unopened" } }

  if (field.type === "multiselect")
    return { kind: "multiselect", index, field, picked: [...(field.default ?? [])], customText: "" }

  if (field.type === "boolean")
    return {
      kind: "choice",
      index,
      field,
      choice:
        field.default === undefined
          ? { mode: "none", customDraft: "" }
          : { mode: "preset", value: String(field.default), customDraft: "" },
      error: undefined,
    }

  if (field.type === "string" && field.options?.length) {
    const value = field.default

    const choice: ProviderFormChoice =
      value === undefined
        ? { mode: "none", customDraft: "" }
        : field.options.some((option) => option.value === value)
          ? { mode: "preset", value, customDraft: "" }
          : field.custom
            ? { mode: "custom", text: value }
            : { mode: "none", customDraft: "" }

    return { kind: "choice", index, field, choice, error: undefined }
  }

  return {
    kind: "text",
    index,
    field,
    text: field.default === undefined ? "" : String(field.default),
    error: undefined,
  }
}

function select(step: Extract<ProviderFormStep, { kind: "choice" }>, value: string): ProviderFormChoice | undefined {
  const choice = step.choice

  if (value === "custom") {
    if (step.field.type !== "string" || !step.field.custom || choice.mode === "custom") return

    return { mode: "custom", text: choice.customDraft }
  }

  const known =
    step.field.type === "boolean"
      ? value === "true" || value === "false"
      : (step.field.options ?? []).some((option) => option.value === value)

  if (!known || (choice.mode === "preset" && choice.value === value)) return

  return { mode: "preset", value, customDraft: choice.mode === "custom" ? choice.text : choice.customDraft }
}

function choiceValue(step: Extract<ProviderFormStep, { kind: "choice" }>): FormValue | undefined {
  const choice = step.choice

  if (choice.mode === "none") return

  if (choice.mode === "custom") return choice.text.trim() || undefined

  return step.field.type === "boolean" ? choice.value === "true" : choice.value
}

function multiselectIssue(step: Extract<ProviderFormStep, { kind: "multiselect" }>) {
  const count = step.picked.length
  const field = step.field

  if (field.required && count === 0) return "select-one" as const

  if (field.minItems !== undefined && count < field.minItems) return "min-items" as const

  if (field.maxItems !== undefined && count > field.maxItems) return "max-items" as const
}

function unchanged(state: ProviderFormState, effects: readonly ProviderFormEffect[] = []): ProviderFormTransition {
  return { state, effects }
}
