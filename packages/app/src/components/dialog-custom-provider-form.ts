const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
export const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

type Translator = (key: string, vars?: Record<string, string | number | boolean>) => string

const MODALITIES = ["text", "audio", "image", "video", "pdf"] as const
const MODEL_STATUSES = ["active", "beta", "alpha", "deprecated"] as const

type ModelConfigKind = "string" | "number" | "boolean" | "status" | "modalities" | "json"

export type ModelConfigField = {
  key: string
  label: string
  kind: ModelConfigKind
  placeholder: string
}

export const MODEL_CONFIG_FIELDS: ModelConfigField[] = [
  { key: "family", label: "family", kind: "string", placeholder: "gpt-4o" },
  { key: "release_date", label: "release_date", kind: "string", placeholder: "2024-05-13" },
  { key: "attachment", label: "attachment", kind: "boolean", placeholder: "true / false" },
  { key: "reasoning", label: "reasoning", kind: "boolean", placeholder: "true / false" },
  { key: "temperature", label: "temperature", kind: "boolean", placeholder: "true / false" },
  { key: "tool_call", label: "tool_call", kind: "boolean", placeholder: "true / false" },
  { key: "interleaved", label: "interleaved", kind: "json", placeholder: 'true or {"field":"reasoning_content"}' },
  { key: "cost.input", label: "cost.input", kind: "number", placeholder: "0.15" },
  { key: "cost.output", label: "cost.output", kind: "number", placeholder: "0.6" },
  { key: "cost.cache_read", label: "cost.cache_read", kind: "number", placeholder: "0.075" },
  { key: "cost.cache_write", label: "cost.cache_write", kind: "number", placeholder: "0.3" },
  { key: "cost.context_over_200k.input", label: "cost.context_over_200k.input", kind: "number", placeholder: "0.3" },
  { key: "cost.context_over_200k.output", label: "cost.context_over_200k.output", kind: "number", placeholder: "1.2" },
  {
    key: "cost.context_over_200k.cache_read",
    label: "cost.context_over_200k.cache_read",
    kind: "number",
    placeholder: "0.15",
  },
  {
    key: "cost.context_over_200k.cache_write",
    label: "cost.context_over_200k.cache_write",
    kind: "number",
    placeholder: "0.6",
  },
  { key: "limit.context", label: "limit.context", kind: "number", placeholder: "128000" },
  { key: "limit.input", label: "limit.input", kind: "number", placeholder: "128000" },
  { key: "limit.output", label: "limit.output", kind: "number", placeholder: "4096" },
  { key: "modalities.input", label: "modalities.input", kind: "modalities", placeholder: "text,image" },
  { key: "modalities.output", label: "modalities.output", kind: "modalities", placeholder: "text" },
  { key: "experimental", label: "experimental", kind: "boolean", placeholder: "true / false" },
  { key: "status", label: "status", kind: "status", placeholder: "active / beta / alpha / deprecated" },
  { key: "provider.npm", label: "provider.npm", kind: "string", placeholder: "@ai-sdk/openai-compatible" },
  { key: "provider.api", label: "provider.api", kind: "string", placeholder: "openai-compatible" },
  { key: "options", label: "options", kind: "json", placeholder: '{"reasoningEffort":"high"}' },
  { key: "headers", label: "headers", kind: "json", placeholder: '{"X-Header":"value"}' },
  { key: "variants", label: "variants", kind: "json", placeholder: '{"low":{"reasoningEffort":"low"}}' },
]

export type ModelConfigRow = {
  key: string
  kind: ModelConfigKind
  example: string
  value: string
  err?: string
}

export type ModelErr = {
  id?: string
  name?: string
  config?: Record<string, string | undefined>
}

export type HeaderErr = {
  key?: string
  value?: string
}

export type ModelRow = {
  row: string
  id: string
  name: string
  expanded: boolean
  config: ModelConfigRow[]
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
  npm?: string
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
  currentProviderID?: string
}

function modelConfigRows(input?: Record<string, unknown>): ModelConfigRow[] {
  return MODEL_CONFIG_FIELDS.map((field) => ({
    key: field.key,
    kind: field.kind,
    example: field.placeholder,
    value: stringifyConfigValue(readPath(input, field.key)),
  }))
}

function modelConfigType(kind: ModelConfigKind) {
  if (kind === "modalities") return "array"
  if (kind === "status") return "enum"
  return kind
}

export function modelConfigPlaceholder(row: ModelConfigRow, t: Translator) {
  return t("provider.custom.models.config.placeholder", {
    type: modelConfigType(row.kind),
    example: row.example,
  })
}

function readPath(input: Record<string, unknown> | undefined, path: string) {
  if (!input) return undefined
  let current: unknown = input
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function stringifyConfigValue(value: unknown) {
  if (value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function setPath(output: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".")
  let current = output
  for (const part of parts.slice(0, -1)) {
    const next = current[part]
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      const created: Record<string, unknown> = {}
      current[part] = created
      current = created
      continue
    }
    current = next as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

function parseBoolean(value: string, t: Translator) {
  const normalized = value.toLowerCase()
  if (["true", "1", "yes", "on"].includes(normalized)) return { value: true }
  if (["false", "0", "no", "off"].includes(normalized)) return { value: false }
  return { error: t("provider.custom.error.boolean") }
}

function parseNumber(value: string, t: Translator) {
  const parsed = Number(value)
  if (Number.isFinite(parsed)) return { value: parsed }
  return { error: t("provider.custom.error.number") }
}

function parseJson(value: string, t: Translator) {
  try {
    return { value: JSON.parse(value) }
  } catch {
    return { error: t("provider.custom.error.json") }
  }
}

function parseStatus(value: string, t: Translator) {
  if ((MODEL_STATUSES as readonly string[]).includes(value)) return { value }
  return { error: t("provider.custom.error.status") }
}

function parseModalities(value: string, t: Translator) {
  const parsed = value.trim().startsWith("[")
    ? parseJson(value, t)
    : {
        value: value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      }
  if (parsed.error) return parsed
  if (!Array.isArray(parsed.value)) return { error: t("provider.custom.error.modalities") }
  if (parsed.value.every((item) => typeof item === "string" && (MODALITIES as readonly string[]).includes(item))) {
    return { value: parsed.value }
  }
  return { error: t("provider.custom.error.modalities") }
}

function parseConfigField(field: ModelConfigField, raw: string, t: Translator) {
  const value = raw.trim()
  if (!value) return {}
  if (field.kind === "string") return { value }
  if (field.kind === "boolean") return parseBoolean(value, t)
  if (field.kind === "number") return parseNumber(value, t)
  if (field.kind === "status") return parseStatus(value, t)
  if (field.kind === "modalities") return parseModalities(value, t)
  return parseJson(value, t)
}

function parseModelConfig(model: ModelRow, t: Translator) {
  const output: Record<string, unknown> = {}
  const errors: Record<string, string | undefined> = {}
  for (const row of model.config) {
    const field = MODEL_CONFIG_FIELDS.find((item) => item.key === row.key)
    if (!field) continue
    const parsed = parseConfigField(field, row.value, t)
    if ("error" in parsed && typeof parsed.error === "string") {
      errors[row.key] = parsed.error
      continue
    }
    if ("value" in parsed) setPath(output, row.key, parsed.value)
  }
  return {
    value: output,
    errors,
    valid: Object.keys(errors).length === 0,
  }
}

export function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const npm = input.form.npm?.trim() || OPENAI_COMPATIBLE
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
    : input.existingProviderIDs.has(providerID) && providerID !== input.currentProviderID && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const seenModels = new Set<string>()
  const parsedModels = input.form.models.map((m) => parseModelConfig(m, input.t))
  const models = input.form.models.map((m, index) => {
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
    return { id: idError, name: nameError, config: parsedModels[index].errors }
  })
  const modelsValid = models.every((m) => !m.id && !m.name && Object.keys(m.config ?? {}).length === 0)
  const modelConfig = Object.fromEntries(
    input.form.models.map((m, index) => [m.id.trim(), { name: m.name.trim(), ...parsedModels[index].value }]),
  )

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
        npm,
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

export const modelRow = (): ModelRow => ({
  row: nextRow(),
  id: "",
  name: "",
  expanded: false,
  config: modelConfigRows(),
  err: {},
})
export const headerRow = (): HeaderRow => ({ row: nextRow(), key: "", value: "", err: {} })
export const modelConfig = modelConfigRows
