import type { ExperimentalProviderCustomCreateInput } from "@opencode/client/promise"

export type CustomProviderInput = Omit<ExperimentalProviderCustomCreateInput, "location">

export type CustomProviderPackage = CustomProviderInput["package"]

export const CUSTOM_PROVIDER_PACKAGES = [
  "@opencode/ai/providers/openai-compatible",
  "@opencode/ai/providers/anthropic-compatible",
] as const satisfies readonly CustomProviderPackage[]

// Config files and model references use the ID, so it stays a plain slug.
const ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/u

// The server reloads providers in the background after saving, and announces them with `model.updated`.
export const CUSTOM_MODELS_TIMEOUT_MS = 10_000

// Mutable: the form edits these fields in a Solid store.
export type CustomProviderFields = {
  name: string
  id: string
  /** The ID follows the name until it is edited by hand. */
  idEdited: boolean
  package: CustomProviderPackage
  baseURL: string
  apiKey: string
  models: { key: string; id: string; name: string }[]
  headers: { key: string; name: string; value: string }[]
}

export type CustomProviderError =
  | "required"
  | "id.invalid"
  | "id.taken"
  | "url.invalid"
  | "models.required"
  | "model.duplicate"
  | "header.incomplete"

/** Field errors keyed by `name`, `id`, `baseURL`, `models`, `models.<key>` and `headers.<key>`. */
export type CustomProviderErrors = Readonly<Record<string, CustomProviderError>>

export function customProviderID(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-_]+|-+$/gu, "")
}

export function validateCustomProvider(
  fields: CustomProviderFields,
  taken: ReadonlySet<string>,
):
  | { readonly type: "valid"; readonly input: CustomProviderInput }
  | { readonly type: "invalid"; readonly errors: CustomProviderErrors } {
  const name = fields.name.trim()
  const id = fields.id.trim()
  const baseURL = fields.baseURL.trim()

  const models = fields.models
    .map((model) => ({ key: model.key, id: model.id.trim(), name: model.name.trim() }))
    .filter((model) => model.id || model.name)

  const headers = fields.headers
    .map((header) => ({ key: header.key, name: header.name.trim(), value: header.value.trim() }))
    .filter((header) => header.name || header.value)

  const errors = new Map<string, CustomProviderError>()
  const seen = new Set<string>()

  if (!name) errors.set("name", "required")

  const idError = idProblem(id, taken)

  if (idError) errors.set("id", idError)

  const urlError = urlProblem(baseURL)

  if (urlError) errors.set("baseURL", urlError)

  if (models.length === 0) errors.set("models", "models.required")

  models.forEach((model) => {
    const key = `models.${model.key}`

    if (!model.id) return void errors.set(key, "required")

    if (seen.has(model.id)) return void errors.set(key, "model.duplicate")
    seen.add(model.id)
  })
  headers.forEach((header) => {
    if (!header.name || !header.value) errors.set(`headers.${header.key}`, "header.incomplete")
  })

  if (errors.size > 0) return { type: "invalid", errors: Object.fromEntries(errors) }

  // Undefined optional fields are left out of the request body.
  return {
    type: "valid",
    input: {
      id,
      name,
      package: fields.package,
      baseURL,
      apiKey: fields.apiKey.trim() || undefined,
      headers:
        headers.length > 0 ? Object.fromEntries(headers.map((header) => [header.name, header.value])) : undefined,
      models: models.map((model) => ({ id: model.id, name: model.name || undefined })),
    },
  }
}

function idProblem(id: string, taken: ReadonlySet<string>): CustomProviderError | undefined {
  if (!id) return "required"

  if (!ID_PATTERN.test(id)) return "id.invalid"

  if (taken.has(id)) return "id.taken"
}

function urlProblem(url: string): CustomProviderError | undefined {
  if (!url) return "required"

  if (!isHttpURL(url)) return "url.invalid"
}

function isHttpURL(value: string) {
  if (/\s/u.test(value)) return false
  const url = URL.parse(value)

  return url?.protocol === "http:" || url?.protocol === "https:"
}

export type CustomSubmitState =
  | { readonly status: "editing"; readonly attempt: number; readonly error?: string }
  | { readonly status: "saving"; readonly attempt: number; readonly providerID: string }
  /** Saved; waiting for the server to load the provider's models. */
  | { readonly status: "loading"; readonly attempt: number; readonly providerID: string }
  | { readonly status: "done"; readonly attempt: number }
  | { readonly status: "disposed"; readonly attempt: number }

export type CustomSubmitEvent =
  | { readonly type: "submitted"; readonly input: CustomProviderInput }
  | { readonly type: "save.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "save.succeeded"; readonly attempt: number }
  | { readonly type: "models.loaded"; readonly attempt: number; readonly firstModel: string }
  | { readonly type: "timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type CustomSubmitEffect =
  | { readonly type: "save"; readonly attempt: number; readonly input: CustomProviderInput }
  | { readonly type: "timer.start"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timer.stop" }
  | { readonly type: "created"; readonly providerID: string; readonly firstModel: string | undefined }

export type CustomSubmitTransition = {
  readonly state: CustomSubmitState
  readonly effects: readonly CustomSubmitEffect[]
}

export const CUSTOM_SUBMIT_IDLE: CustomSubmitState = { status: "editing", attempt: 0 }

export function transitionCustomSubmit(state: CustomSubmitState, event: CustomSubmitEvent): CustomSubmitTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed")
    return {
      state: { status: "disposed", attempt: state.attempt },
      effects: state.status === "loading" ? [{ type: "timer.stop" }] : [],
    }

  if (event.type === "submitted") {
    if (state.status !== "editing") return { state, effects: [] }
    const attempt = state.attempt + 1

    return {
      state: { status: "saving", attempt, providerID: event.input.id },
      effects: [{ type: "save", attempt, input: event.input }],
    }
  }

  if (event.attempt !== state.attempt) return { state, effects: [] }

  if (event.type === "save.failed") {
    if (state.status !== "saving") return { state, effects: [] }

    return { state: { status: "editing", attempt: state.attempt, error: event.error }, effects: [] }
  }

  if (event.type === "save.succeeded") {
    if (state.status !== "saving") return { state, effects: [] }

    return {
      state: { status: "loading", attempt: state.attempt, providerID: state.providerID },
      effects: [{ type: "timer.start", attempt: state.attempt, timeoutMs: CUSTOM_MODELS_TIMEOUT_MS }],
    }
  }

  if (state.status !== "loading") return { state, effects: [] }

  // The provider is saved either way; without its models the dialog closes instead of listing them.
  return {
    state: { status: "done", attempt: state.attempt },
    effects: [
      { type: "timer.stop" },
      {
        type: "created",
        providerID: state.providerID,
        firstModel: event.type === "models.loaded" ? event.firstModel : undefined,
      },
    ],
  }
}

// What the submit button area shows while the form is busy.
const SUBMIT_PHASE = {
  editing: undefined,
  saving: "saving",
  loading: "loading",
  done: "saving",
  disposed: "saving",
} as const satisfies Record<CustomSubmitState["status"], "saving" | "loading" | undefined>

export function selectCustomSubmitView(state: CustomSubmitState) {
  return {
    busy: state.status !== "editing",
    phase: SUBMIT_PHASE[state.status],
    error: state.status === "editing" ? state.error : undefined,
  }
}
