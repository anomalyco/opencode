const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"
export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh"] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

const DEFAULT_REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"]
const FAST_REASONING_EFFORT: ReasoningEffort = "low"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

export type ModelErr = {
  id?: string
  name?: string
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  configOpen: boolean
  reasoning: boolean
  efforts: Record<ReasoningEffort, boolean>
  fast: boolean
  err: ModelErr
}

export type HeaderRow = {
  row: string
  key: string
  value: string
  err: HeaderErr
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  err: {
    providerID?: string
    name?: string
    baseURL?: string
  }
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const models = input.form.models.map((m) => {
    const id = m.id.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    const nameError = !m.name.trim() ? input.t("provider.custom.error.required") : undefined
    return { id: idError, name: nameError }
  })
  const modelsValid = models.every((m) => !m.id && !m.name)
  const modelConfig = Object.fromEntries(input.form.models.map((m) => [m.id.trim(), modelConfigFor(m)]))

  const seenHeaders = new Set<string>()
  const headers = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())
            return undefined
          })()
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headers.every((h) => !h.key && !h.value)
  const headerConfig = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const err = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { err, models, headers }

  return {
    err,
    models,
    headers,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: OPENAI_COMPATIBLE,
        name,
        ...(env ? { env: [env] } : {}),
        options: {
          baseURL,
          ...(Object.keys(headerConfig).length ? { headers: headerConfig } : {}),
        },
        models: modelConfig,
      },
    },
  }
}

let row = 0

const nextRow = () => `row-${row++}`

function modelConfigFor(model: ModelRow) {
  const base = { name: model.name.trim() }
  if (!model.reasoning && !model.fast) return base

  const effortVariants = model.reasoning
    ? REASONING_EFFORTS.map(
        (effort) => [effort, model.efforts[effort] ? { reasoningEffort: effort } : { disabled: true }] as const,
      )
    : []
  const fastVariant = model.fast
    ? ([
        "fast",
        model.reasoning
          ? {
              reasoningEffort: FAST_REASONING_EFFORT,
              textVerbosity: "low",
            }
          : { textVerbosity: "low" },
      ] as const)
    : (["fast", { disabled: true }] as const)

  return {
    ...base,
    ...(model.reasoning ? { reasoning: true } : {}),
    variants: Object.fromEntries([fastVariant, ...effortVariants]),
  }
}

function defaultReasoningEfforts() {
  return Object.fromEntries(
    REASONING_EFFORTS.map((effort) => [effort, DEFAULT_REASONING_EFFORTS.includes(effort)]),
  ) as Record<ReasoningEffort, boolean>
}

export const modelRow = (): ModelRow => ({
  row: nextRow(),
  id: "",
  name: "",
  configOpen: false,
  reasoning: false,
  efforts: defaultReasoningEfforts(),
  fast: false,
  err: {},
})
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })
